<?php

/*
|--------------------------------------------------------------------------
| i18n-keyless
|--------------------------------------------------------------------------
|
| One .env line is enough: I18N_KEYLESS_API_KEY. Everything else has a
| sensible default. Get a key at https://i18n-keyless.com/#get-api-key
|
*/

return [

    // Set to false to switch the package off: Laravel then behaves exactly as
    // without it (lang/*.json files, source text on a miss).
    'enabled' => (bool) env('I18N_KEYLESS_ENABLED', true),

    // Your project's API key. Without it the package stays inactive.
    'api_key' => env('I18N_KEYLESS_API_KEY'),

    // The official service, or your own backend / proxy speaking the same
    // three-route wire format (see docs: "Proxy through your backend").
    'api_url' => env('I18N_KEYLESS_API_URL', 'https://api.i18n-keyless.com'),

    // The language your source strings are written in, as an i18n-keyless code
    // ("en", "fr", "pt-BR", "zh-Hans"...). A Laravel locale ("pt_BR", "zh_CN")
    // is accepted and mapped. Defaults to config('app.locale').
    'primary' => env('I18N_KEYLESS_PRIMARY_LANG'),

    // REQUIRED for translation: every language your app serves, comma separated
    // ("en,fr,es"). A new string is translated into all of them at once, and
    // the API stores this list as the project's languages (it replaces the
    // previous list). When empty, missing strings are NOT sent to the API:
    // they are served as their source text, and one warning is logged.
    'languages' => env('I18N_KEYLESS_LANGUAGES'),

    // The i18n-keyless namespace the __() strings live in. Keep "default"
    // unless you partition a very large project.
    'namespace' => env('I18N_KEYLESS_NAMESPACE', 'default'),

    'cache' => [
        // A store name from config/cache.php, or null for the default store.
        'store' => env('I18N_KEYLESS_CACHE_STORE'),

        // Seconds a fetched dictionary is served without asking the API again.
        // After that, the next request revalidates it with the ETag after the
        // response is sent (an unchanged dictionary costs a bodyless 304).
        'ttl' => (int) env('I18N_KEYLESS_CACHE_TTL', 3600),

        // Prefix of every cache key written by this package.
        'prefix' => 'i18n-keyless',
    ],

    // HTTP timeout in seconds for every API call (the SDK default is 10 s).
    'timeout' => 10,

    // Backoff in milliseconds between retries. Two entries = two retries. A
    // network error, a timeout, a 429 or a 5xx is retried; any other 4xx is not.
    'retry' => [500, 1500],

    // Maximum number of /translate requests in flight at once (SDK default: 30).
    'concurrency' => 30,

    // Usage analytics: the date each string was last served is sent to
    // POST /translate/last-used-translations after the response, at most once
    // every 10 s, like the node SDK. It lets the dashboard prune unused strings.
    'usage' => (bool) env('I18N_KEYLESS_USAGE', true),

    // Queue name to dispatch the missing strings to (a job per request), or
    // null to send them right after the response, in the same process.
    'queue' => env('I18N_KEYLESS_QUEUE'),

];
