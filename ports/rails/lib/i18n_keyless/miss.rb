# frozen_string_literal: true

module I18nKeyless
  # One source string that had no translation, with the languages it was
  # requested in. Sent to POST /translate once per (namespace, key, context).
  class Miss
    attr_reader :key, :context, :namespace, :langs

    def initialize(key, context = nil, namespace = Translator::DEFAULT_NAMESPACE, langs = [])
      @key = key
      @context = context.to_s.empty? ? nil : context
      @namespace = namespace.to_s.empty? ? Translator::DEFAULT_NAMESPACE : namespace
      @langs = Array(langs).dup
    end

    # The lookup key, stored exactly like the SDKs: "key__context".
    def lookup_key
      self.class.lookup_key_for(key, context)
    end

    def self.lookup_key_for(key, context)
      context.nil? || context.to_s.empty? ? key.to_s : "#{key}__#{context}"
    end

    # Dedupe id: one POST per (namespace, key, context), whatever the languages.
    def id
      "#{namespace}:#{lookup_key}"
    end

    def add_lang(lang)
      @langs << lang unless @langs.include?(lang)
    end

    # A plain Hash (string keys), for an ActiveJob argument.
    def to_h
      { "key" => key, "context" => context, "namespace" => namespace, "langs" => langs.dup }
    end

    def self.from_h(data)
      data = data.transform_keys(&:to_s)
      new(data["key"], data["context"], data["namespace"] || Translator::DEFAULT_NAMESPACE, data["langs"] || [])
    end
  end
end
