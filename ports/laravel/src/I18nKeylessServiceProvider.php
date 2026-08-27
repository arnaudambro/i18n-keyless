<?php

namespace I18nKeyless\Laravel;

use Illuminate\Contracts\Cache\Factory as CacheFactory;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Support\ServiceProvider;
use Illuminate\Translation\Translator;

/**
 * Auto-discovered. Publishes `config/i18n-keyless.php`, hooks Laravel's
 * translator for missing keys, and flushes the misses after each response.
 */
final class I18nKeylessServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/i18n-keyless.php', 'i18n-keyless');

        $this->app->singleton(KeylessTranslator::class, fn (Application $app) => self::makeTranslator($app));
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/i18n-keyless.php' => $this->app->configPath('i18n-keyless.php'),
        ], 'i18n-keyless-config');

        if (! self::enabled($this->app)) {
            return;
        }

        $this->callAfterResolving('translator', function (Translator $translator) {
            $translator->handleMissingKeysUsing(
                fn (string $key, array $replace, string $locale, bool $fallback) => $this->app
                    ->make(KeylessTranslator::class)
                    ->handleMissingKey($key, $replace, $locale, $fallback)
            );
        });

        // After the response is sent (HTTP), after the command (console)...
        $this->app->terminating(fn () => $this->flush());
        // ...and after each job of a long-lived queue worker.
        $this->app->make(Dispatcher::class)->listen(JobProcessed::class, fn () => $this->flush());
    }

    private function flush(): void
    {
        if ($this->app->resolved(KeylessTranslator::class)) {
            $this->app->make(KeylessTranslator::class)->flush();
        }
    }

    public static function enabled(Application $app): bool
    {
        $config = $app['config']->get('i18n-keyless', []);

        return ! empty($config['enabled']) && ! empty($config['api_key']);
    }

    public static function makeTranslator(Application $app): KeylessTranslator
    {
        $config = $app['config']->get('i18n-keyless', []);
        $apiKey = (string) ($config['api_key'] ?? '');
        $apiUrl = rtrim((string) ($config['api_url'] ?? ApiClient::DEFAULT_URL), '/') ?: ApiClient::DEFAULT_URL;
        $cache = $config['cache'] ?? [];

        $primary = Locale::toLang($config['primary'] ?? null)
            ?? Locale::toLang($app['config']->get('app.locale'))
            ?? 'en';

        $languages = $config['languages'] ?? [];
        if (is_string($languages)) {
            $languages = explode(',', $languages);
        }
        $languages = array_values(array_filter(array_map(
            fn ($tag) => Locale::toLang(is_string($tag) ? $tag : null),
            is_array($languages) ? $languages : []
        )));
        $languages = array_values(array_unique($languages));

        $retry = $config['retry'] ?? [500, 1500];

        return new KeylessTranslator(
            translator: $app->make('translator'),
            store: new DictionaryStore(
                cache: $app->make(CacheFactory::class)->store($cache['store'] ?? null),
                prefix: (string) ($cache['prefix'] ?? 'i18n-keyless'),
                ttl: max(0, (int) ($cache['ttl'] ?? 3600)),
                apiKeyHash: substr(sha1($apiKey), 0, 8),
            ),
            api: new ApiClient(
                http: $app->make(Http::class),
                apiKey: $apiKey,
                apiUrl: $apiUrl,
                timeout: max(1, (int) ($config['timeout'] ?? 10)),
                retryDelays: array_values(array_map('intval', is_array($retry) ? $retry : [500, 1500])),
                concurrency: max(1, (int) ($config['concurrency'] ?? 30)),
            ),
            primary: $primary,
            languages: $languages,
            defaultNamespace: (string) (($config['namespace'] ?? '') ?: KeylessTranslator::DEFAULT_NAMESPACE),
            queue: $config['queue'] ?? null,
            app: $app,
            usageEnabled: (bool) ($config['usage'] ?? true),
        );
    }
}
