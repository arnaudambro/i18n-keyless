# frozen_string_literal: true

require "json"

module I18nKeyless
  # The precompiled bundle (docs/PROTOCOL.md, sections 4.5 and 7.4): a
  # directory holding `manifest.json` and one `<namespace>/<lang>.json` per
  # dictionary, as the MCP `export_bundle` tool or `GET /translate/bundle`
  # yields it.
  #
  # A (namespace, lang) pair the manifest covers is read from the file instead
  # of fetched, with the manifest's cursor. The two class methods `covers?`
  # and `merge_with_storage` are pure and replayed by
  # conformance/vectors/bundle-seed.json.
  #
  # Seed: { translations: Hash, last_refresh: String|nil }
  # Stored: { translations: Hash, last_refresh: Object, lang: String }
  class Bundle
    attr_reader :path, :manifest

    def initialize(path, manifest)
      @path = path
      @manifest = manifest
    end

    # Reads `manifest.json` from the directory. Nil when no path is configured;
    # nil with one warning when the path holds no readable manifest.
    def self.load(path, logger: nil)
      path = path.to_s.strip.sub(%r{[/\\]+\z}, "")
      return nil if path.empty?

      manifest = read_json(File.join(path, "manifest.json"))
      unless manifest.is_a?(Hash) && manifest["namespaces"].is_a?(Hash)
        warn_with(logger, "bundle_path \"#{path}\" holds no readable manifest.json: the bundle is ignored")
        return nil
      end
      new(path, manifest)
    end

    # `bundleCovers(manifest, namespace, lang)` of the SDKs: true when the
    # manifest lists `lang` under `namespace`.
    def self.covers?(manifest, namespace, lang)
      return false unless manifest.is_a?(Hash)

      languages = manifest.dig("namespaces", namespace.to_s, "languages")
      languages.is_a?(Array) && languages.include?(lang.to_s)
    end

    # `mergeBundleWithStorage(bundle, stored, lang)` of the SDKs: the bundle is
    # the base. What storage holds is merged on top (its keys win) and its
    # cursor kept ONLY when its cursor is a strictly larger number than the
    # bundle's AND it is in `lang`. A stored cursor that is empty, nil or not a
    # number is never newer.
    def self.merge_with_storage(bundle, stored, lang)
      return bundle if stored.nil? || stored[:lang] != lang

      stored_cursor = cursor_number(stored[:last_refresh])
      return bundle if stored_cursor.nil?

      # `Number(x)` of the SDKs: nil and "" are 0, anything else non-numeric is NaN,
      # and nothing is larger than NaN.
      bundle_raw = bundle[:last_refresh]
      bundle_cursor = bundle_raw.nil? || bundle_raw.to_s.empty? ? 0.0 : cursor_number(bundle_raw)
      return bundle if bundle_cursor.nil? || stored_cursor <= bundle_cursor

      {
        translations: bundle[:translations].merge(stored[:translations] || {}),
        last_refresh: stored[:last_refresh]
      }
    end

    def self.cursor_number(value)
      return nil if value.nil?
      return value.to_f if value.is_a?(Numeric)

      text = value.to_s.strip
      return nil if text.empty?

      Float(text, exception: false)
    end

    def self.read_json(file)
      return nil unless File.file?(file) && File.readable?(file)

      JSON.parse(File.read(file))
    rescue JSON::ParserError, SystemCallError, IOError, EncodingError
      nil
    end

    def self.warn_with(logger, message)
      logger&.warn("i18n-keyless: #{message}")
    rescue StandardError
      # Logging must never take a translation down.
    end

    def covers?(namespace, lang)
      self.class.covers?(manifest, namespace, lang)
    end

    # The namespaces the manifest lists, in manifest order.
    def namespaces
      manifest["namespaces"].keys.map(&:to_s)
    end

    # The languages the manifest lists under one namespace.
    def languages(namespace)
      languages = manifest.dig("namespaces", namespace.to_s, "languages")
      languages.is_a?(Array) ? languages.map(&:to_s) : []
    end

    # Every (namespace, lang) pair the manifest covers, in manifest order.
    def pairs
      namespaces.flat_map { |namespace| languages(namespace).map { |lang| [namespace, lang] } }
    end

    # The cursor of one namespace (epoch ms as a string), or nil.
    def last_refresh(namespace)
      cursor = manifest.dig("namespaces", namespace.to_s, "lastRefresh")
      cursor.nil? ? nil : cursor.to_s
    end

    # One covered dictionary with its cursor, or nil when the pair is not
    # covered or the file is unreadable (logged: the caller falls back to the
    # fetch, like a pair the manifest does not list).
    def seed(namespace, lang, logger: nil)
      return nil unless covers?(namespace, lang)

      file = File.join(path, namespace.to_s, "#{lang}.json")
      translations = self.class.read_json(file)
      unless translations.is_a?(Hash)
        self.class.warn_with(logger, "bundle file \"#{file}\" is missing or unreadable: #{namespace}/#{lang} is fetched instead")
        return nil
      end
      { translations: translations.select { |_, v| v.is_a?(String) }, last_refresh: last_refresh(namespace) }
    end
  end
end
