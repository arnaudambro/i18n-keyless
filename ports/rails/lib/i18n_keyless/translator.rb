# frozen_string_literal: true

module I18nKeyless
  # The bridge between Rails' I18n and the i18n-keyless API.
  #
  # Nothing happens until the first lookup that misses in a non-primary
  # locale. That miss loads the locale's dictionary (from the cache, or from the
  # API once) and keeps it in this process. A miss that is not in the dictionary
  # either is recorded and the source text is returned. The misses are sent to
  # POST /translate after the response (the Rack middleware), or as an
  # ActiveJob when `queue` is set.
  #
  # With usage reporting on (the default, like the node SDK), the date each
  # key was last served is recorded and POSTed to
  # /translate/last-used-translations after the response, at most once every
  # 10 s across processes.
  #
  # One instance per process, shared by every thread: the per-request state
  # (misses, usage, dictionaries to revalidate) sits behind a mutex, and a
  # flush takes whatever is there, whichever request recorded it.
  class Translator
    DEFAULT_NAMESPACE = "default"

    NO_LANGUAGES_WARNING = "I18N_KEYLESS_LANGUAGES is required for translation: set it to every language " \
                           "your app serves (for example \"en,fr,es\"). Missing strings are served as their " \
                           "source text until then."

    attr_reader :store, :api, :primary, :languages, :default_namespace, :queue, :logger

    def self.build(config)
      api_key = config.api_key.to_s
      new(
        store: DictionaryStore.new(
          cache: config.resolved_cache,
          prefix: config.cache_prefix.to_s.empty? ? "i18n-keyless" : config.cache_prefix.to_s,
          ttl: config.cache_ttl,
          api_key_hash: DictionaryStore.hash_key(api_key)
        ),
        api: ApiClient.new(
          api_key: api_key,
          api_url: config.resolved_api_url,
          timeout: [config.timeout.to_i, 1].max,
          retry_delays: config.resolved_retry,
          concurrency: [config.concurrency.to_i, 1].max,
          logger: config.resolved_logger
        ),
        primary: config.resolved_primary,
        languages: config.resolved_languages,
        default_namespace: config.resolved_namespace,
        queue: config.queue,
        usage_enabled: config.usage?,
        logger: config.resolved_logger
      )
    end

    def initialize(store:, api:, primary:, languages: [], default_namespace: DEFAULT_NAMESPACE, queue: nil,
                   usage_enabled: true, logger: nil)
      @store = store
      @api = api
      @primary = primary
      @languages = languages
      @default_namespace = default_namespace
      @queue = queue.to_s.empty? ? nil : queue.to_s
      @usage_enabled = usage_enabled
      @logger = logger
      @mutex = Mutex.new
      @loaded = {}      # "lang|namespace" => lines loaded in this process
      @misses = {}      # Miss#id => Miss
      @revalidate = {}  # "lang|namespace" => [lang, namespace]
      @usage = {}       # namespace => lookup key => YYYY-MM-DD
      @warned_no_languages = false
    end

    def usage_enabled?
      @usage_enabled
    end

    # `resolveNamespace` of the SDKs: the per-call namespace, else the
    # configured default, else the literal `default`. Empty strings fall through.
    def self.resolve_namespace(per_call, config_default)
      return per_call.to_s unless per_call.nil? || per_call.to_s.empty?
      return config_default.to_s unless config_default.nil? || config_default.to_s.empty?

      DEFAULT_NAMESPACE
    end

    # The `i18nk` helper: a translation with an optional `context`, `%{name}`
    # placeholders replaced by I18n after the lookup.
    def get(text, values = {}, context: nil, locale: nil, namespace: nil)
      text = text.to_s
      return text if text.empty?

      locale = (locale || I18n.locale).to_s
      translated = lookup(locale, text, context: context, namespace: namespace) || text
      I18nKeyless.interpolate(translated, values)
    end

    # The backend path. Returns the translation when the dictionary has it,
    # the source text otherwise (never nil for a context lookup, so
    # "key__context" never leaks to the page).
    def lookup(locale, key, context: nil, namespace: nil)
      key = key.to_s
      return key if key.empty?

      namespace = self.class.resolve_namespace(namespace, default_namespace)
      lookup_key = Miss.lookup_key_for(key, context)
      lang = Locale.to_lang(locale.to_s)
      return key if lang.nil?

      # Usage is recorded in the primary locale too, so the API does not prune
      # keys that only ever render in their source language (node SDK rule).
      record_usage(namespace, lookup_key)
      return key if lang == primary

      lines = ensure_loaded(lang, namespace)
      value = lines[lookup_key]
      # An empty stored translation counts as missing, like in the SDKs.
      return value if value.is_a?(String) && !value.empty?

      record_miss(key, context, namespace, lang)
      key
    end

    # Loads the (lang, namespace) dictionary once per process.
    def ensure_loaded(lang, namespace)
      id = "#{lang}|#{namespace}"
      @mutex.synchronize do
        return @loaded[id] if @loaded.key?(id)

        entry = store.get(lang, namespace)
        if entry.nil?
          # First time ever for this language: the one blocking fetch.
          result = api.fetch_dictionary(lang, namespace, nil)
          entry = if result.ok
                    store.put(lang, namespace, result.translations, result.etag)
                  else
                    store.put(lang, namespace, {}, nil, failed: true)
                  end
        elsif store.stale?(entry)
          # Serve what we have now, ask the API after the response.
          @revalidate[id] = [lang, namespace]
        end
        @loaded[id] = entry[:translations]
      end
    end

    # Forgets the dictionaries loaded in this process (I18n.reload!).
    def reset_loaded!
      @mutex.synchronize { @loaded.clear }
    end

    def pending_usage
      @mutex.synchronize { @usage.transform_values(&:dup) }
    end

    def pending_misses
      @mutex.synchronize { @misses.values }
    end

    # Runs after the response is sent: POSTs the misses, then revalidates the
    # stale dictionaries served during the request, then sends the usage.
    # Never raises.
    def flush
      misses, revalidate = @mutex.synchronize do
        taken = [@misses.values, @revalidate.values]
        @misses = {}
        @revalidate = {}
        taken
      end

      misses = [] if !misses.empty? && !can_translate?
      claimed = misses.select { |miss| store.claim_miss(miss) }
      unless claimed.empty?
        if queue && defined?(I18nKeyless::TranslateMissingKeysJob)
          TranslateMissingKeysJob.set(queue: queue).perform_later(claimed.map(&:to_h))
        else
          translate_now(claimed)
        end
      end

      revalidate.each { |(lang, namespace)| revalidate_now(lang, namespace) }

      flush_usage
    rescue StandardError => e
      warn("flush error: #{e.message}")
    end

    # POST /translate for each miss and merge the answers into the cache, so
    # the very next request has them. The dictionaries are then marked stale:
    # the next request revalidates them with the API after its response.
    def translate_now(misses)
      return if misses.empty? || !can_translate?

      results = api.translate(misses, primary, languages)
      touched = {}
      misses.each do |miss|
        translation = results[miss.id]
        if translation.nil?
          store.release_miss(miss)
          next
        end
        lookup_key = miss.lookup_key
        translation.each do |lang, text|
          next if lang == primary || !Locale.lang?(lang) || text.to_s.empty?

          (touched["#{miss.namespace}|#{lang}"] ||= {})[lookup_key] = text
        end
      end
      touched.each do |id, lines|
        namespace, lang = id.split("|", 2)
        store.merge(lang, namespace, lines)
        refresh_loaded(lang, namespace, lines)
      end
    end

    private

    def record_usage(namespace, lookup_key)
      return if !usage_enabled? || lookup_key.empty?

      date = Time.now.utc.strftime("%Y-%m-%d")
      @mutex.synchronize { (@usage[namespace] ||= {})[lookup_key] = date }
    end

    def record_miss(key, context, namespace, lang)
      return if key.empty?

      miss = Miss.new(key, context, namespace)
      @mutex.synchronize do
        miss = (@misses[miss.id] ||= miss)
        miss.add_lang(lang)
      end
    end

    # Merges this request's usage dates into the stored map, then POSTs the
    # whole map when it holds unsent changes and no POST left in the last 10 s.
    # Fire and forget: a failure keeps the changes for a later request.
    def flush_usage
      recorded = @mutex.synchronize do
        taken = @usage
        @usage = {}
        taken
      end
      return unless usage_enabled?

      store.merge_usage(recorded) unless recorded.empty?
      return if !store.usage_dirty? || !store.claim_usage_slot

      result = api.send_usage(primary, store.usage)
      store.clear_usage_dirty if result.ok
    rescue StandardError
      # Analytics must never affect the response.
    end

    # POST /translate overwrites the project's language list with the one it
    # receives, so a miss is never sent without a configured list: it would
    # shrink the project to the primary language and damage every other client
    # on the same API key. The source text is served instead.
    def can_translate?
      return true unless languages.empty?

      unless @warned_no_languages
        @warned_no_languages = true
        warn(NO_LANGUAGES_WARNING)
      end
      false
    end

    def revalidate_now(lang, namespace)
      entry = store.get(lang, namespace)
      result = api.fetch_dictionary(lang, namespace, entry && entry[:etag])
      unless result.ok
        # Remember the failure briefly, so the next requests do not all retry.
        store.put(lang, namespace, entry ? entry[:translations] : {}, entry && entry[:etag], failed: true)
        return
      end
      if result.not_modified
        store.touch(lang, namespace)
        return
      end
      store.put(lang, namespace, result.translations, result.etag)
      refresh_loaded(lang, namespace, result.translations)
    end

    # Keeps this process's loaded lines current (a long-lived process keeps
    # the dictionaries between requests).
    def refresh_loaded(lang, namespace, lines)
      id = "#{lang}|#{namespace}"
      @mutex.synchronize do
        @loaded[id] = @loaded[id].merge(lines) if @loaded.key?(id)
      end
    end

    def warn(message)
      logger&.warn("i18n-keyless: #{message}")
    rescue StandardError
      # Logging must never take a translation down.
    end
  end
end
