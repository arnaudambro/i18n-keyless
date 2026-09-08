# frozen_string_literal: true

require "digest/sha1"

module I18nKeyless
  # The per-language dictionaries in an ActiveSupport cache store (any: memory,
  # file, Redis, Memcached, the database), plus the cross-request guard that
  # keeps one miss from being POSTed by every request.
  #
  # A dictionary entry is stored forever: `ttl` is not its lifetime but the time
  # it is served without asking the API. A stale entry is still served, and
  # revalidated with its ETag after the response (a 304 keeps it as is).
  #
  # Entry: { translations: Hash, etag: String|nil, fetched_at: Integer, failed: Boolean, last_refresh: String|nil }
  #
  # `last_refresh` is the API's cursor for the dictionary (epoch ms as a
  # string, PROTOCOL.md section 4.2), or the bundle's when the entry was seeded
  # from one. It is never sent on the wire (the ETag carries freshness here):
  # it decides the precedence between a bundle and the cache (`seed`).
  class DictionaryStore
    # Seconds a failed fetch is remembered before the API is asked again.
    FAILURE_TTL = 60

    # Minimum seconds between two usage POSTs, across every process (the node SDK's debounce).
    USAGE_FLUSH_SECONDS = 10

    attr_reader :cache, :prefix, :ttl, :api_key_hash

    def initialize(cache:, prefix:, ttl:, api_key_hash:)
      @cache = cache
      @prefix = prefix
      @ttl = [ttl.to_i, 0].max
      @api_key_hash = api_key_hash
    end

    def self.hash_key(api_key)
      Digest::SHA1.hexdigest(api_key.to_s)[0, 8]
    end

    def get(lang, namespace)
      entry = cache.read(key(lang, namespace))
      return nil unless entry.is_a?(Hash)

      entry = entry.transform_keys(&:to_sym)
      entry[:translations].is_a?(Hash) ? entry : nil
    end

    def put(lang, namespace, translations, etag, failed: false, last_refresh: nil)
      entry = { translations: translations, etag: etag, fetched_at: Time.now.to_i, failed: failed, last_refresh: last_refresh }
      cache.write(key(lang, namespace), entry)
      entry
    end

    # Applies one bundle dictionary (PROTOCOL.md 7.4) to the stored entry with
    # the SDKs' precedence (`Bundle.merge_with_storage`): the bundle is the
    # base and the stored slice is merged on top, its cursor kept, only when
    # the cache is strictly newer than the bundle. Otherwise the bundle's lines
    # win, its cursor is stored, and the entry is fresh: no fetch and no
    # revalidation until `ttl` seconds pass. Keys the cache has and the bundle
    # lacks (a merged POST answer) are kept either way. Idempotent: a second
    # call with the same bundle writes nothing.
    #
    # @param seed [Hash] { translations: Hash, last_refresh: String|nil }
    def seed(lang, namespace, seed)
      stored = get(lang, namespace)
      merged = Bundle.merge_with_storage(
        seed,
        stored && { translations: stored[:translations], last_refresh: stored[:last_refresh], lang: lang },
        lang
      )
      translations = (stored ? stored[:translations] : {}).merge(merged[:translations])
      storage_wins = stored && merged[:last_refresh] != seed[:last_refresh]
      if storage_wins
        return stored if translations == stored[:translations]

        entry = stored.merge(translations: translations)
      else
        return stored if stored && translations == stored[:translations] && stored[:last_refresh] == merged[:last_refresh]

        # The ETag named what the API answered before the export: it no longer matches this content.
        entry = { translations: translations, etag: nil, fetched_at: Time.now.to_i, failed: false, last_refresh: merged[:last_refresh] }
      end
      cache.write(key(lang, namespace), entry)
      entry
    end

    # After a 304: same dictionary, same ETag, fresh again.
    def touch(lang, namespace)
      entry = get(lang, namespace)
      return if entry.nil?

      entry[:fetched_at] = Time.now.to_i
      entry[:failed] = false
      cache.write(key(lang, namespace), entry)
    end

    # Adds freshly translated lines to a stored dictionary (after POST /translate),
    # and marks it stale so the next request revalidates with the API.
    def merge(lang, namespace, lines)
      entry = get(lang, namespace) || { translations: {}, etag: nil, fetched_at: 0, failed: false }
      entry[:translations] = entry[:translations].merge(lines)
      entry[:fetched_at] = 0
      cache.write(key(lang, namespace), entry)
    end

    def mark_stale(lang, namespace)
      entry = get(lang, namespace)
      return if entry.nil?

      entry[:fetched_at] = 0
      cache.write(key(lang, namespace), entry)
    end

    def stale?(entry)
      max_age = entry[:failed] ? [FAILURE_TTL, ttl].min : ttl
      (Time.now.to_i - entry[:fetched_at].to_i) > max_age
    end

    # Claims a miss for this process: true when nobody POSTed it during the last
    # `ttl` seconds. Atomic on stores that honour `unless_exist` (Redis,
    # Memcached, the database store, the file store, the memory store).
    def claim_miss(miss)
      return true if ttl.zero?

      cache.write(miss_key(miss), 1, expires_in: ttl, unless_exist: true) ? true : false
    end

    # After a failed POST: let a later request try again.
    def release_miss(miss)
      cache.delete(miss_key(miss))
    end

    # The cumulative usage map, `{ namespace => { "key__context" => "YYYY-MM-DD" } }`,
    # never cleared (the node SDK keeps it for the life of the process; here it
    # lives in the cache for the life of the cache).
    def usage
      usage = cache.read(usage_key)
      usage.is_a?(Hash) ? usage : {}
    end

    # Merges freshly recorded dates into the stored map. True when a date
    # changed (a new key, or a key seen on a new day).
    def merge_usage(recorded)
      usage = self.usage
      changed = false
      recorded.each do |namespace, keys|
        keys.each do |key, date|
          next if usage.dig(namespace, key) == date

          (usage[namespace] ||= {})[key] = date
          changed = true
        end
      end
      if changed
        cache.write(usage_key, usage)
        cache.write("#{usage_key}:dirty", true)
      end
      changed
    end

    # True while the stored map holds changes the API has not received.
    def usage_dirty?
      cache.read("#{usage_key}:dirty") ? true : false
    end

    def clear_usage_dirty
      cache.delete("#{usage_key}:dirty")
    end

    # Claims the right to POST usage now: false when a POST left less than 10 s ago.
    def claim_usage_slot
      cache.write("#{usage_key}:lock", 1, expires_in: USAGE_FLUSH_SECONDS, unless_exist: true) ? true : false
    end

    def usage_key
      "#{prefix}:#{api_key_hash}:usage"
    end

    def key(lang, namespace)
      "#{prefix}:#{api_key_hash}:dict:#{namespace}:#{lang}"
    end

    private

    def miss_key(miss)
      "#{prefix}:#{api_key_hash}:miss:#{Digest::SHA1.hexdigest(miss.id)}"
    end
  end
end
