# frozen_string_literal: true

require "test_helper"

class MissTest < Minitest::Test
  def test_lookup_key_and_id
    miss = I18nKeyless::Miss.new("8 heures", "time", "checkout")
    assert_equal "8 heures__time", miss.lookup_key
    assert_equal "checkout:8 heures__time", miss.id
    assert_equal "Bonjour", I18nKeyless::Miss.new("Bonjour").lookup_key
    assert_equal "default:Bonjour", I18nKeyless::Miss.new("Bonjour", "", "").id
  end

  def test_langs_are_deduplicated
    miss = I18nKeyless::Miss.new("Bonjour")
    miss.add_lang("en")
    miss.add_lang("en")
    miss.add_lang("es")
    assert_equal %w[en es], miss.langs
  end

  def test_round_trips_through_a_hash
    miss = I18nKeyless::Miss.new("Bonjour", "greeting", "app", %w[en])
    copy = I18nKeyless::Miss.from_h(miss.to_h)
    assert_equal miss.id, copy.id
    assert_equal %w[en], copy.langs
    assert_equal({ "key" => "Bonjour", "context" => "greeting", "namespace" => "app", "langs" => ["en"] }, miss.to_h)
    assert_equal "default", I18nKeyless::Miss.from_h({ "key" => "x" }).namespace
    assert_equal "app", I18nKeyless::Miss.from_h({ key: "x", namespace: "app" }).namespace
  end
end
