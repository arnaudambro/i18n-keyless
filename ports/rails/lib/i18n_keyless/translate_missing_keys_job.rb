# frozen_string_literal: true

module I18nKeyless
  # Sends the misses of one request to POST /translate from a queue worker.
  # Enqueued when `config.queue` (I18N_KEYLESS_QUEUE) is set.
  class TranslateMissingKeysJob < ::ActiveJob::Base
    def perform(misses)
      I18nKeyless.translator.translate_now(misses.map { |miss| Miss.from_h(miss) })
    end
  end
end
