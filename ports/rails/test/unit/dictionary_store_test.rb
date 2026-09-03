# frozen_string_literal: true

require "test_helper"

class DictionaryStoreTest < Minitest::Test
  def setup
    @cache = ActiveSupport::Cache::MemoryStore.new
    @store = I18nKeyless::DictionaryStore.new(cache: @cache, prefix: "i18n-keyless", ttl: 3600, api_key_hash: "abcd1234")
  end

  def test_key_layout_matches_the_laravel_port
    assert_equal "i18n-keyless:abcd1234:dict:default:en", @store.key("en", "default")
    assert_equal "i18n-keyless:abcd1234:usage", @store.usage_key
    assert_equal Digest::SHA1.hexdigest("test-key")[0, 8], I18nKeyless::DictionaryStore.hash_key("test-key")
  end

  def test_put_get_and_staleness
    assert_nil @store.get("en", "default")
    entry = @store.put("en", "default", { "Bonjour" => "Hello" }, 'W/"1"')
    assert_equal({ "Bonjour" => "Hello" }, @store.get("en", "default")[:translations])
    refute @store.stale?(entry)
    assert @store.stale?(entry.merge(fetched_at: Time.now.to_i - 3601))
    # a failed fetch is remembered 60 s only
    failed = @store.put("en", "default", {}, nil, failed: true)
    refute @store.stale?(failed)
    assert @store.stale?(failed.merge(fetched_at: Time.now.to_i - 61))
  end

  def test_merge_marks_stale_and_touch_refreshes
    @store.put("en", "default", { "A" => "a" }, 'W/"1"')
    @store.merge("en", "default", { "B" => "b" })
    entry = @store.get("en", "default")
    assert_equal({ "A" => "a", "B" => "b" }, entry[:translations])
    assert @store.stale?(entry)
    @store.touch("en", "default")
    refute @store.stale?(@store.get("en", "default"))
    @store.mark_stale("en", "default")
    assert @store.stale?(@store.get("en", "default"))
    # touch and mark_stale on an absent entry are no-ops
    @store.touch("es", "default")
    @store.mark_stale("es", "default")
    assert_nil @store.get("es", "default")
  end

  def test_merge_on_an_empty_store_creates_the_entry
    @store.merge("en", "default", { "B" => "b" })
    assert_equal({ "B" => "b" }, @store.get("en", "default")[:translations])
  end

  def test_a_corrupt_entry_reads_as_nil
    @cache.write(@store.key("en", "default"), "garbage")
    assert_nil @store.get("en", "default")
    @cache.write(@store.key("en", "default"), { translations: "no" })
    assert_nil @store.get("en", "default")
  end

  def test_claim_miss_is_atomic_per_ttl
    miss = I18nKeyless::Miss.new("Bonjour")
    assert @store.claim_miss(miss)
    refute @store.claim_miss(miss)
    @store.release_miss(miss)
    assert @store.claim_miss(miss)
    zero = I18nKeyless::DictionaryStore.new(cache: @cache, prefix: "p", ttl: 0, api_key_hash: "x")
    assert zero.claim_miss(miss)
    assert zero.claim_miss(miss)
  end

  def test_usage_map_and_dirty_flag
    assert_equal({}, @store.usage)
    refute @store.usage_dirty?
    assert @store.merge_usage({ "default" => { "Bonjour" => "2026-08-04" } })
    assert @store.usage_dirty?
    refute @store.merge_usage({ "default" => { "Bonjour" => "2026-08-04" } })
    assert @store.merge_usage({ "default" => { "Bonjour" => "2026-08-05" }, "checkout" => { "Payer" => "2026-08-05" } })
    assert_equal({ "default" => { "Bonjour" => "2026-08-05" }, "checkout" => { "Payer" => "2026-08-05" } }, @store.usage)
    @store.clear_usage_dirty
    refute @store.usage_dirty?
    assert @store.claim_usage_slot
    refute @store.claim_usage_slot
  end
end
