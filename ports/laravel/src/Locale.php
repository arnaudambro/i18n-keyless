<?php

namespace I18nKeyless\Laravel;

/**
 * Maps a Laravel locale ("fr", "pt_BR", "zh_CN", "en-GB") onto one of the 48
 * i18n-keyless language codes. A port of `resolveLang` from i18n-keyless-core.
 */
final class Locale
{
    /** The 48 languages i18n-keyless translates into, as the API spells them (v3). */
    public const AVAILABLE_LANGS = [
        'ar', 'bn', 'ca', 'zh-Hans', 'zh-Hant', 'hr', 'cs', 'da', 'nl', 'en', 'en-GB', 'fi',
        'fr', 'fr-CA', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'ms',
        'ml', 'mr', 'no', 'or', 'pl', 'pt', 'pt-BR', 'pa', 'ro', 'ru', 'sk', 'sl', 'es', 'es-MX',
        'sv', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi',
    ];

    /**
     * Chinese is selected by script, not by region, and the regions do not map
     * to a script by name, so the common region tags are spelled out.
     */
    private const CHINESE_REGION_SCRIPTS = [
        'cn' => 'zh-Hans',
        'sg' => 'zh-Hans',
        'hans' => 'zh-Hans',
        'tw' => 'zh-Hant',
        'hk' => 'zh-Hant',
        'mo' => 'zh-Hant',
        'hant' => 'zh-Hant',
    ];

    /**
     * The App Store Connect listing slot of each code (a convenience the SDKs
     * ship; not a wire concern).
     */
    public const APP_STORE_LOCALES = [
        'ar' => 'ar-SA', 'bn' => 'bn', 'ca' => 'ca', 'zh-Hans' => 'zh-Hans', 'zh-Hant' => 'zh-Hant',
        'hr' => 'hr', 'cs' => 'cs', 'da' => 'da', 'nl' => 'nl-NL', 'en' => 'en-US', 'en-GB' => 'en-GB',
        'fi' => 'fi', 'fr' => 'fr-FR', 'fr-CA' => 'fr-CA', 'de' => 'de-DE', 'el' => 'el', 'gu' => 'gu',
        'he' => 'he', 'hi' => 'hi', 'hu' => 'hu', 'id' => 'id', 'it' => 'it', 'ja' => 'ja', 'kn' => 'kn',
        'ko' => 'ko', 'ms' => 'ms', 'ml' => 'ml', 'mr' => 'mr', 'no' => 'no', 'or' => 'or', 'pl' => 'pl',
        'pt' => 'pt-PT', 'pt-BR' => 'pt-BR', 'pa' => 'pa', 'ro' => 'ro', 'ru' => 'ru', 'sk' => 'sk',
        'sl' => 'sl', 'es' => 'es-ES', 'es-MX' => 'es-MX', 'sv' => 'sv', 'ta' => 'ta', 'te' => 'te',
        'th' => 'th', 'tr' => 'tr', 'uk' => 'uk', 'ur' => 'ur', 'vi' => 'vi',
    ];

    /** @var array<string, string>|null lowercased code => canonical code */
    private static ?array $byLowercase = null;

    /**
     * The i18n-keyless code for a locale tag, most specific match first, or
     * null when no supported language matches.
     *
     *   toLang('pt_BR')  => 'pt-BR'
     *   toLang('pt-AO')  => 'pt'
     *   toLang('zh_CN')  => 'zh-Hans'
     *   toLang('zh_TW')  => 'zh-Hant'
     *   toLang('es-419') => 'es-MX'
     *   toLang('xx')     => null
     */
    public static function toLang(?string $tag): ?string
    {
        return self::resolve($tag);
    }

    /**
     * `resolveLang(tag, { supported, fallback })` of the SDKs: the first
     * candidate present in `$supported` (when given), else `$fallback`.
     *
     *   resolve('pt-BR', ['pt', 'en'], 'en') => 'pt'
     *   resolve('ja', ['pt', 'en'], 'en')    => 'en'
     *
     * @param  list<string>|null  $supported
     */
    public static function resolve(?string $tag, ?array $supported = null, ?string $fallback = null): ?string
    {
        foreach (self::candidates($tag) as $candidate) {
            if ($supported === null || in_array($candidate, $supported, true)) {
                return $candidate;
            }
        }

        return $fallback;
    }

    /** `toAppStoreLocale('fr')` => `'fr-FR'`. */
    public static function toAppStoreLocale(string $lang): ?string
    {
        return self::APP_STORE_LOCALES[$lang] ?? null;
    }

    public static function isLang(string $code): bool
    {
        return in_array($code, self::AVAILABLE_LANGS, true);
    }

    /** @return list<string> */
    private static function candidates(?string $tag): array
    {
        if ($tag === null) {
            return [];
        }
        $normalized = strtolower(trim(str_replace('_', '-', $tag)));
        if ($normalized === '') {
            return [];
        }
        $parts = explode('-', $normalized);
        $language = $parts[0];
        $region = $parts[count($parts) - 1];
        $map = self::byLowercase();
        $candidates = [];
        $push = function (?string $lang) use (&$candidates): void {
            if ($lang !== null && ! in_array($lang, $candidates, true)) {
                $candidates[] = $lang;
            }
        };

        // 1. the tag as written ("pt-BR", "zh-Hans")
        $push($map[$normalized] ?? null);

        // 2. Chinese resolves by script and never falls back to a bare language
        if ($language === 'zh') {
            $push(self::CHINESE_REGION_SCRIPTS[$region] ?? 'zh-Hans');

            return $candidates;
        }

        // 3. UN M49 code for Latin America, which is what the es-MX slot really covers
        if ($normalized === 'es-419') {
            $push('es-MX');
        }

        // 4. the bare language ("pt-AO" => "pt")
        $push($map[$language] ?? null);

        return $candidates;
    }

    /** @return array<string, string> */
    private static function byLowercase(): array
    {
        if (self::$byLowercase === null) {
            self::$byLowercase = [];
            foreach (self::AVAILABLE_LANGS as $lang) {
                self::$byLowercase[strtolower($lang)] = $lang;
            }
        }

        return self::$byLowercase;
    }
}
