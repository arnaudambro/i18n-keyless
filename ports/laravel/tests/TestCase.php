<?php

namespace I18nKeyless\Laravel\Tests;

use I18nKeyless\Laravel\I18nKeylessServiceProvider;
use Illuminate\Support\Facades\Http;
use Orchestra\Testbench\TestCase as Orchestra;

abstract class TestCase extends Orchestra
{
    protected function getPackageProviders($app): array
    {
        return [I18nKeylessServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('app.locale', 'fr');
        $app['config']->set('app.fallback_locale', 'fr');
        $app['config']->set('cache.default', 'array');
        $app['config']->set('i18n-keyless.api_key', 'test-key');
        $app['config']->set('i18n-keyless.api_url', 'https://api.test');
        $app['config']->set('i18n-keyless.primary', 'fr');
        $app['config']->set('i18n-keyless.languages', 'fr,en,es');
    }

    public const USAGE_URL = 'https://api.test/translate/last-used-translations';

    /**
     * `Http::fake()` with the usage analytics sink stubbed first, so a wildcard
     * dictionary stub never swallows it.
     *
     * @param  array<string, mixed>  $stubs
     */
    protected function fakeApi(array $stubs): void
    {
        Http::fake([self::USAGE_URL => Http::response(['ok' => true, 'message' => ''])] + $stubs);
    }

    protected function usageRequests(): int
    {
        return Http::recorded(fn (\Illuminate\Http\Client\Request $r) => $r->method() === 'POST' && $r->url() === self::USAGE_URL)->count();
    }

    protected function translatePosts(): int
    {
        return Http::recorded(fn (\Illuminate\Http\Client\Request $r) => $r->method() === 'POST' && $r->url() === 'https://api.test/translate')->count();
    }

    protected function dictionaryGets(): int
    {
        return Http::recorded(fn (\Illuminate\Http\Client\Request $r) => $r->method() === 'GET' && str_starts_with($r->url(), 'https://api.test/translate/'))->count();
    }

    /** @param array<string, string> $translations */
    protected function dictionaryResponse(array $translations, string $etag = 'W/"1"'): \GuzzleHttp\Promise\PromiseInterface
    {
        return Http::response(['ok' => true, 'data' => ['translations' => $translations], 'error' => '', 'message' => ''], 200, ['ETag' => $etag]);
    }

    /** @param array<string, string> $translation */
    protected function translatedResponse(array $translation): \GuzzleHttp\Promise\PromiseInterface
    {
        return Http::response(['ok' => true, 'data' => ['translation' => $translation], 'error' => '', 'message' => '']);
    }

    protected function dictKey(string $lang, string $namespace = 'default', string $apiKey = 'test-key'): string
    {
        return 'i18n-keyless:'.substr(sha1($apiKey), 0, 8).":dict:{$namespace}:{$lang}";
    }

    protected function usageKey(string $apiKey = 'test-key'): string
    {
        return 'i18n-keyless:'.substr(sha1($apiKey), 0, 8).':usage';
    }
}
