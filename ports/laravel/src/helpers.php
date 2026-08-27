<?php

use I18nKeyless\Laravel\I18nKeylessServiceProvider;
use I18nKeyless\Laravel\KeylessTranslator;

if (! function_exists('i18nk')) {
    /**
     * `__()` with an i18n-keyless `context`, for ambiguous strings:
     *
     *     i18nk('8 heures', context: 'duration')   // "8 hours"
     *     i18nk('8 heures', context: 'clock time') // "8 AM"
     *
     * The string is stored as "key__context", exactly like the SDKs. `:name`
     * placeholders in `$replace` are Laravel's own replacement.
     *
     * @param  array<string, mixed>  $replace
     */
    function i18nk(string $text, array $replace = [], ?string $context = null, ?string $locale = null, ?string $namespace = null): string
    {
        $app = app();
        if (! $app->bound(KeylessTranslator::class) || ! I18nKeylessServiceProvider::enabled($app)) {
            return __($text, $replace, $locale);
        }

        return $app->make(KeylessTranslator::class)->get($text, $replace, $context, $locale, $namespace);
    }
}
