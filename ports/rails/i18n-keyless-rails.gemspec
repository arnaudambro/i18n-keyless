# frozen_string_literal: true

require_relative "lib/i18n_keyless/version"

Gem::Specification.new do |spec|
  spec.name = "i18n-keyless-rails"
  spec.version = I18nKeyless::VERSION
  spec.authors = ["Arnaud Ambroselli"]
  spec.email = ["arnaud.ambroselli.io@gmail.com"]

  spec.summary = "Keyless translations for Ruby on Rails: t('Welcome to our app') resolves through the i18n-keyless API."
  spec.description = "Keyless translations for Rails. Write the source string where a key would go, " \
                     "t('Welcome to our app'), and it resolves through the i18n-keyless API: AI translation " \
                     "on the first miss, cached in Rails.cache, served from there. One gem, two .env lines, " \
                     "no config/locales/*.yml to maintain by hand."
  spec.homepage = "https://i18n-keyless.com"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.1"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/arnaudambro/i18n-keyless/tree/main/ports/rails"
  spec.metadata["documentation_uri"] = "https://docs.i18n-keyless.com"
  spec.metadata["changelog_uri"] = "https://github.com/arnaudambro/i18n-keyless/blob/main/CHANGELOG.md"
  spec.metadata["rubygems_mfa_required"] = "true"

  spec.files = Dir["lib/**/*.rb", "README.md", "SKILL.md", "llms.txt", "LICENSE.md"]
  spec.require_paths = ["lib"]

  spec.add_dependency "activesupport", ">= 7.0"
  spec.add_dependency "i18n", ">= 1.8"
end
