<?php

namespace I18nKeyless\Laravel\Tests\Unit;

use I18nKeyless\Laravel\Locale;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class LocaleTest extends TestCase
{
    /** @return iterable<string, array{?string, ?string}> */
    public static function tags(): iterable
    {
        yield 'bare' => ['fr', 'fr'];
        yield 'laravel underscore variant' => ['pt_BR', 'pt-BR'];
        yield 'laravel region without variant' => ['fr_FR', 'fr'];
        yield 'en_US collapses to en' => ['en_US', 'en'];
        yield 'en_GB is its own variant' => ['en_GB', 'en-GB'];
        yield 'zh_CN is simplified' => ['zh_CN', 'zh-Hans'];
        yield 'zh_TW is traditional' => ['zh_TW', 'zh-Hant'];
        yield 'zh_HK is traditional' => ['zh_HK', 'zh-Hant'];
        yield 'bare zh is simplified' => ['zh', 'zh-Hans'];
        yield 'zh-Hans as written' => ['zh-Hans', 'zh-Hans'];
        yield 'es-419 is Latin America' => ['es-419', 'es-MX'];
        yield 'pt-AO falls back to pt' => ['pt-AO', 'pt'];
        yield 'case insensitive' => ['PT-br', 'pt-BR'];
        yield 'v2 code cz is unknown' => ['cz', null];
        yield 'zh_Hant script tag' => ['zh_Hant', 'zh-Hant'];
        yield 'zh-SG is simplified' => ['zh-SG', 'zh-Hans'];
        yield 'zh-MO is traditional' => ['zh-MO', 'zh-Hant'];
        yield 'zh with an unknown region is simplified' => ['zh-XX', 'zh-Hans'];
        yield 'es_419 with an underscore' => ['es_419', 'es-MX'];
        yield 'fr-ca lowercase' => ['fr-ca', 'fr-CA'];
        yield 'fr-BE falls back to fr' => ['fr-BE', 'fr'];
        yield 'surrounding whitespace is trimmed' => [' fr ', 'fr'];
        yield 'a region alone is unknown' => ['BR', null];
        yield 'unknown' => ['xx', null];
        yield 'unknown with a region' => ['xx-YY', null];
        yield 'whitespace only' => ['   ', null];
        yield 'empty' => ['', null];
        yield 'null' => [null, null];
    }

    #[DataProvider('tags')]
    public function test_maps_laravel_locales_to_sdk_codes(?string $tag, ?string $expected): void
    {
        $this->assertSame($expected, Locale::toLang($tag));
    }

    public function test_resolve_picks_the_first_supported_candidate_else_the_fallback(): void
    {
        $this->assertSame('pt-BR', Locale::resolve('pt-BR'));
        $this->assertSame('pt', Locale::resolve('pt-BR', ['pt', 'en'], 'en'));
        $this->assertSame('pt-BR', Locale::resolve('pt-BR', ['pt-BR', 'pt'], 'en'));
        $this->assertSame('en', Locale::resolve('ja', ['pt', 'en'], 'en'));
        $this->assertNull(Locale::resolve('ja', ['pt', 'en']));
        $this->assertSame('en', Locale::resolve(null, ['pt', 'en'], 'en'));
        $this->assertNull(Locale::resolve('zh-TW', ['zh-Hans'], null), 'Chinese never falls back to another script');
    }

    public function test_app_store_locales(): void
    {
        $this->assertSame('fr-FR', Locale::toAppStoreLocale('fr'));
        $this->assertSame('pt-PT', Locale::toAppStoreLocale('pt'));
        $this->assertNull(Locale::toAppStoreLocale('xx'));
        $this->assertSame(Locale::AVAILABLE_LANGS, array_keys(Locale::APP_STORE_LOCALES));
    }

    public function test_the_48_codes(): void
    {
        $this->assertCount(48, Locale::AVAILABLE_LANGS);
        $this->assertTrue(Locale::isLang('cs'));
        $this->assertFalse(Locale::isLang('cz'));
    }
}
