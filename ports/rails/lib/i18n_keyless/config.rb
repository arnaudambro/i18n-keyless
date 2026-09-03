# frozen_string_literal: true

module I18nKeyless
  # The configuration, with the same names and defaults as the Laravel port.
  # Every value is read from the environment first (`I18N_KEYLESS_*`), then
  # overridden by `I18nKeyless.configure { |c| ... }`.
  class Config
    # A key matching this is a Rails key (`hello`, `users.index.title`): it is
    # left to the YAML files. Everything else is a keyless source string.
    DEFAULT_RAILS_KEY_PATTERN = /\A[a-z0-9_]+(\.[a-z0-9_]+)*\z/

    FALSE_VALUES = %w[false 0 off no].freeze

    # `false` switches the gem off: Rails behaves as without it.
    attr_accessor :enabled
    # Your project's key. Without it the gem stays inactive.
    attr_accessor :api_key
    # The official service, or your own backend / proxy speaking the same wire format.
    attr_accessor :api_url
    # The language the source strings are written in. Default: I18n.default_locale.
    attr_accessor :primary
    # REQUIRED for translation: every language the app serves ("en,fr,es" or an array).
    attr_accessor :languages
    # The i18n-keyless namespace of the `t()` strings. Default "default".
    attr_accessor :namespace
    # An ActiveSupport::Cache::Store. Default: Rails.cache, else a MemoryStore.
    attr_accessor :cache
    # Seconds a dictionary is served without asking the API. Default 3600.
    attr_accessor :cache_ttl
    # Prefix of every cache key the gem writes.
    attr_accessor :cache_prefix
    # HTTP timeout in seconds, per attempt.
    attr_accessor :timeout
    # Backoff in milliseconds between retries: two entries, two retries.
    attr_accessor :retry
    # Maximum POST /translate requests in flight at once.
    attr_accessor :concurrency
    # Usage analytics (the date each string was last served), like the node SDK.
    attr_accessor :usage
    # An ActiveJob queue name: misses are sent from a TranslateMissingKeysJob instead of after the response.
    attr_accessor :queue
    # Where warnings go. Default: Rails.logger, else STDERR.
    attr_accessor :logger
    # The Rails-key rule (see DEFAULT_RAILS_KEY_PATTERN). `nil`: every string is keyless.
    attr_accessor :rails_key_pattern

    def initialize(env = ENV)
      @enabled = truthy?(env.fetch("I18N_KEYLESS_ENABLED", "true"))
      @api_key = env["I18N_KEYLESS_API_KEY"]
      @api_url = env["I18N_KEYLESS_API_URL"]
      @primary = env["I18N_KEYLESS_PRIMARY_LANG"]
      @languages = env["I18N_KEYLESS_LANGUAGES"]
      @namespace = env["I18N_KEYLESS_NAMESPACE"]
      @cache = nil
      @cache_ttl = Integer(env.fetch("I18N_KEYLESS_CACHE_TTL", 3600), exception: false) || 3600
      @cache_prefix = "i18n-keyless"
      @timeout = 10
      @retry = [500, 1500]
      @concurrency = 30
      @usage = truthy?(env.fetch("I18N_KEYLESS_USAGE", "true"))
      @queue = env["I18N_KEYLESS_QUEUE"]
      @logger = nil
      @rails_key_pattern = DEFAULT_RAILS_KEY_PATTERN
    end

    def enabled?
      truthy?(enabled) && !api_key.to_s.strip.empty?
    end

    # The primary language as an i18n-keyless code: the configured one, else
    # I18n.default_locale mapped, else "en".
    def resolved_primary
      Locale.to_lang(primary&.to_s) || Locale.to_lang(I18n.default_locale.to_s) || "en"
    end

    # The configured languages as i18n-keyless codes, deduplicated. A comma
    # separated string ("en,fr,es") or an array of locales.
    def resolved_languages
      list = languages
      list = list.split(",") if list.is_a?(String)
      Array(list).filter_map { |tag| Locale.to_lang(tag.to_s) }.uniq
    end

    def resolved_api_url
      url = api_url.to_s.strip.sub(%r{/+\z}, "")
      url.empty? ? ApiClient::DEFAULT_URL : url
    end

    def resolved_namespace
      value = namespace.to_s
      value.empty? ? Translator::DEFAULT_NAMESPACE : value
    end

    def resolved_cache
      return cache if cache
      return ::Rails.cache if defined?(::Rails) && ::Rails.respond_to?(:cache) && ::Rails.cache

      @memory_store ||= ActiveSupport::Cache::MemoryStore.new
    end

    def resolved_logger
      return logger if logger
      return ::Rails.logger if defined?(::Rails) && ::Rails.respond_to?(:logger) && ::Rails.logger

      @stderr_logger ||= Logger.new($stderr)
    end

    def resolved_retry
      Array(self.retry).map(&:to_i)
    end

    def usage?
      truthy?(usage)
    end

    private

    def truthy?(value)
      return value if value == true || value == false
      return false if value.nil?

      !FALSE_VALUES.include?(value.to_s.strip.downcase) && !value.to_s.strip.empty?
    end
  end
end
