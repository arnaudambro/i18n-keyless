# frozen_string_literal: true

require "test_helper"
require "i18n_keyless/translate_missing_keys_job"

class QueueTest < I18nKeylessTest::Case
  include ActiveJob::TestHelper

  def test_misses_are_enqueued_as_one_job_and_translated_by_the_worker
    configure(queue: "i18n")
    stub_dictionary("en")
    stub_translate({ "en" => "New" })
    stub_usage
    I18n.t("Nouveau")
    I18n.t("Nouveau", context: "ctx")
    assert_enqueued_jobs 0
    flush
    assert_enqueued_jobs 1, only: I18nKeyless::TranslateMissingKeysJob
    assert_enqueued_with(job: I18nKeyless::TranslateMissingKeysJob, queue: "i18n")
    assert_not_requested(:post, "#{I18nKeylessTest::API}/translate")

    perform_enqueued_jobs

    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 2)
    assert_equal "New", I18n.t("Nouveau")
    assert_equal "New", cache.read(dict_key("en"))[:translations]["Nouveau"]
  end

  def test_the_job_carries_plain_hashes
    misses = [I18nKeyless::Miss.new("Bonjour", nil, "default", ["en"]).to_h]
    stub_translate({ "en" => "Hello" })
    I18nKeyless::TranslateMissingKeysJob.perform_now(misses)
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
    assert_equal "Hello", cache.read(dict_key("en"))[:translations]["Bonjour"]
  end

  def test_jobs_flush_after_perform
    job_class = Class.new(ActiveJob::Base) do
      include I18nKeyless::Helper
      after_perform { I18nKeyless.flush }
      def perform
        i18nk("Depuis un job")
      end
    end
    stub_dictionary("en")
    stub_translate({ "en" => "From a job" })
    stub_usage
    job_class.perform_now
    assert_requested(:post, "#{I18nKeylessTest::API}/translate", times: 1)
  end
end
