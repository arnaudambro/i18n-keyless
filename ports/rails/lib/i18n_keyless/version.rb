# frozen_string_literal: true

module I18nKeyless
  # Sent as the `Version` header. The API reads its major to pick the wire
  # dialect: >= 3 means the v3 language codes ("zh-Hans", "cs"). One version
  # for every package and port of the monorepo (scripts/set-version.mjs).
  VERSION = "3.5.0"
end
