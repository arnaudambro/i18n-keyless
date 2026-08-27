<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\ApiClient;
use I18nKeyless\Laravel\Jobs\TranslateMissingKeys;
use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Lang;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;

final class TranslationTest extends TestCase
{
    private const EN = ['Bonjour' => 'Hello', 'Bienvenue :name' => 'Welcome :name', '8 heures__duration' => '8 hours', 'Bonjour. Ça va ?' => 'Hello. How are you?'];

    /** @param array<string, string> $translations */
    private function dictionary(array $translations = self::EN, string $etag = 'W/"1"'): \GuzzleHttp\Promise\PromiseInterface
    {
        return Http::response([
            'ok' => true,
            'data' => ['translations' => $translations, 'uniqueId' => null, 'lastRefresh' => '1700000000000'],
            'error' => '',
            'message' => '',
        ], 200, ['ETag' => $etag]);
    }

    /** @param array<string, string> $translation */
    private function translated(array $translation): \GuzzleHttp\Promise\PromiseInterface
    {
        return Http::response(['ok' => true, 'data' => ['translation' => $translation], 'error' => '', 'message' => '']);
    }

    private function dictionaryRequests(): int
    {
        return Http::recorded(fn (Request $r) => $r->method() === 'GET' && str_starts_with($r->url(), 'https://api.test/translate/'))->count();
    }

    private function translateRequests(): int
    {
        return Http::recorded(fn (Request $r) => $r->method() === 'POST' && $r->url() === 'https://api.test/translate')->count();
    }

    public function test_the_first_miss_fetches_the_dictionary_and_underscore_returns_the_translation(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary()]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Welcome Ada', __('Bienvenue :name', ['name' => 'Ada']));
        $this->assertSame('Hello', __('Bonjour'));

        $this->assertSame(1, $this->dictionaryRequests());
        Http::assertSent(function (Request $request) {
            return $request->url() === 'https://api.test/translate/en?last_refresh='
                && $request->hasHeader('Authorization', 'Bearer test-key')
                && $request->hasHeader('Version', ApiClient::VERSION)
                && $request->hasHeader('sdk', 'laravel')
                && ! $request->hasHeader('unique_id')
                && ! $request->hasHeader('If-None-Match');
        });
    }

    public function test_the_primary_locale_never_fetches_nor_translates(): void
    {
        $this->fakeApi([]);
        $this->app->setLocale('fr');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame('Bonjour Ada', __('Bonjour :name', ['name' => 'Ada']));
        $this->assertSame('8 heures', i18nk('8 heures', context: 'duration'));
        $this->app->terminate();

        // No dictionary, no translate: only the usage of the served keys (node SDK rule).
        $this->assertSame(0, $this->dictionaryRequests());
        $this->assertSame(0, $this->translateRequests());
        $this->assertSame(1, $this->usageRequests());
        Http::assertSent(fn (Request $r) => $r->url() === self::USAGE_URL
            && $r->data()['translationsUsageByNamespace'] === ['default' => ['Bonjour' => gmdate('Y-m-d'), 'Bonjour :name' => gmdate('Y-m-d'), '8 heures__duration' => gmdate('Y-m-d')]]);
    }

    public function test_a_missing_key_returns_the_source_and_posts_it_on_terminate(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionary(),
            'https://api.test/translate' => $this->translated(['fr' => 'Au revoir', 'en' => 'Goodbye', 'es' => 'Adiós']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Au revoir', __('Au revoir'));
        $this->assertSame('Au revoir', Lang::get('Au revoir'));
        $this->assertSame(0, $this->translateRequests(), 'the request is never blocked by a miss');

        $this->app->terminate();

        $this->assertSame(1, $this->translateRequests());
        Http::assertSent(function (Request $request) {
            return $request->method() === 'POST'
                && $request->url() === 'https://api.test/translate'
                && $request->hasHeader('Authorization', 'Bearer test-key')
                && $request->hasHeader('Version', ApiClient::VERSION)
                && $request->hasHeader('sdk', 'laravel')
                && $request->hasHeader('Content-Type', 'application/json')
                && $request->data() === ['key' => 'Au revoir', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr'];
        });

        // The answer is merged into the cache: the next request has it without a fetch.
        $store = $this->app->make(KeylessTranslator::class);
        $this->assertSame('Goodbye', Cache::get('i18n-keyless:'.substr(sha1('test-key'), 0, 8).':dict:default:en')['translations']['Au revoir']);
        $this->assertSame('Adiós', Cache::get('i18n-keyless:'.substr(sha1('test-key'), 0, 8).':dict:default:es')['translations']['Au revoir']);
        $this->assertSame([], $store->pendingMisses());
    }

    public function test_misses_are_deduplicated_by_key_and_context(): void
    {
        $this->fakeApi([
            'https://api.test/translate/*' => $this->dictionary([]),
            'https://api.test/translate' => $this->translated(['en' => 'x', 'es' => 'x']),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        __('Au revoir');
        __('Au revoir', ['name' => 'x']);
        i18nk('Au revoir');
        i18nk('Au revoir', context: 'farewell');
        i18nk('Au revoir', context: 'farewell');
        $this->app->setLocale('es');
        __('Au revoir');

        $misses = array_map(fn ($m) => $m->toArray(), $this->app->make(KeylessTranslator::class)->pendingMisses());
        $this->assertSame([
            ['key' => 'Au revoir', 'context' => null, 'namespace' => 'default', 'langs' => ['en', 'es']],
            ['key' => 'Au revoir', 'context' => 'farewell', 'namespace' => 'default', 'langs' => ['en']],
        ], $misses);

        $this->app->terminate();
        $this->assertSame(2, $this->translateRequests());
        Http::assertSent(fn (Request $r) => $r->method() === 'POST' && $r->data() === ['key' => 'Au revoir', 'context' => 'farewell', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr']);

        // A second request (same process here) does not POST the same miss again: the cache guard holds.
        __('Au revoir');
        $this->app->terminate();
        $this->assertSame(2, $this->translateRequests());
    }

    public function test_a_stale_dictionary_is_served_then_revalidated_with_the_etag_and_a_304_keeps_it(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en' => Http::response('', 304),
        ]);
        $cacheKey = 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':dict:default:en';
        Cache::forever($cacheKey, ['translations' => self::EN, 'etag' => 'W/"abc"', 'fetched_at' => 0, 'failed' => false]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame(0, $this->dictionaryRequests(), 'a stale dictionary is served, not refetched inline');

        $this->app->terminate();

        $this->assertSame(1, $this->dictionaryRequests());
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/en' && $r->hasHeader('If-None-Match', 'W/"abc"'));
        $entry = Cache::get($cacheKey);
        $this->assertSame(self::EN, $entry['translations']);
        $this->assertSame('W/"abc"', $entry['etag']);
        $this->assertGreaterThan(0, $entry['fetched_at'], 'a 304 makes the entry fresh again');
    }

    public function test_a_200_on_revalidation_replaces_the_dictionary_and_its_etag(): void
    {
        $this->fakeApi(['https://api.test/translate/en' => $this->dictionary(['Bonjour' => 'Hi'], 'W/"2"')]);
        $cacheKey = 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':dict:default:en';
        Cache::forever($cacheKey, ['translations' => self::EN, 'etag' => 'W/"1"', 'fetched_at' => 0, 'failed' => false]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();

        $entry = Cache::get($cacheKey);
        $this->assertSame(['Bonjour' => 'Hi'], $entry['translations']);
        $this->assertSame('W/"2"', $entry['etag']);
        // The running process picks the new line up too (Octane, queue workers).
        $this->assertSame('Hi', __('Bonjour'));
    }

    public function test_a_4xx_is_not_retried(): void
    {
        Sleep::fake();
        $this->fakeApi(['https://api.test/translate/en*' => Http::response(['ok' => false, 'error' => 'Unauthorized'], 401)]);
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame(1, $this->dictionaryRequests());
        Sleep::assertNeverSlept();
    }

    public function test_a_5xx_is_retried_with_backoff_and_the_request_never_throws(): void
    {
        Sleep::fake();
        $this->fakeApi([
            'https://api.test/translate/en*' => Http::sequence()
                ->pushStatus(503)
                ->pushStatus(500)
                ->push(['ok' => true, 'data' => ['translations' => self::EN], 'error' => '', 'message' => ''], 200, ['ETag' => 'W/"1"']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame(3, $this->dictionaryRequests());
        Sleep::assertSleptTimes(2);
        Sleep::assertSequence([Sleep::for(500)->milliseconds(), Sleep::for(1500)->milliseconds()]);
    }

    public function test_a_5xx_on_every_attempt_falls_back_to_the_source_text(): void
    {
        Sleep::fake();
        $this->fakeApi(['https://api.test/translate/en*' => Http::response('down', 502)]);
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame(3, $this->dictionaryRequests());

        // The failure is remembered: the next lookups do not hammer the API.
        $this->assertSame('Bienvenue', __('Bienvenue'));
        $this->assertSame(3, $this->dictionaryRequests());
    }

    public function test_a_connection_error_is_retried_and_never_throws(): void
    {
        Sleep::fake();
        $attempts = 0;
        $this->fakeApi(['https://api.test/translate/en*' => function () use (&$attempts) {
            $attempts++;
            throw new \Illuminate\Http\Client\ConnectionException('cURL error 28: timeout');
        }]);
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame(3, $attempts);
        Sleep::assertSleptTimes(2);
    }

    public function test_context_is_stored_as_key_context_like_the_sdks(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionary(),
            'https://api.test/translate' => $this->translated(['en' => '8 AM']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('8 hours', i18nk('8 heures', context: 'duration'));
        $this->assertSame('8 heures', i18nk('8 heures', context: 'clock time'), 'a miss returns the source text, never "key__context"');
        $this->assertSame('8 heures', i18nk('8 heures'));

        $this->app->terminate();

        Http::assertSent(fn (Request $r) => $r->method() === 'POST' && $r->data() === ['key' => '8 heures', 'context' => 'clock time', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr']);
        Http::assertSent(fn (Request $r) => $r->method() === 'POST' && $r->data() === ['key' => '8 heures', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr']);
        $cacheKey = 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':dict:default:en';
        $this->assertSame('8 AM', Cache::get($cacheKey)['translations']['8 heures__clock time']);
    }

    public function test_laravel_placeholders_are_replaced_after_translation(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary()]);
        $this->app->setLocale('en');

        $this->assertSame('Welcome Ada', i18nk('Bienvenue :name', ['name' => 'Ada']));
        $this->assertSame('Welcome Ada', __('Bienvenue :name', ['name' => 'Ada']));
        $this->assertSame('Au revoir Ada', __('Au revoir :name', ['name' => 'Ada']), 'a miss still gets its placeholders replaced');
    }

    public function test_keys_containing_a_dot_are_served_too(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary()]);
        $this->app->setLocale('en');

        $this->assertSame('Hello. How are you?', __('Bonjour. Ça va ?'));
        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();
        $this->assertSame(0, $this->translateRequests());
    }

    public function test_laravel_locales_are_mapped_to_sdk_codes(): void
    {
        $this->fakeApi([
            'https://api.test/translate/pt-BR*' => $this->dictionary(['Bonjour' => 'Olá']),
            'https://api.test/translate/zh-Hans*' => $this->dictionary(['Bonjour' => '你好']),
            'https://api.test/translate' => $this->translated([]),
        ]);

        $this->app->setLocale('pt_BR');
        $this->assertSame('Olá', __('Bonjour'));
        $this->app->setLocale('zh_CN');
        $this->assertSame('你好', __('Bonjour'));
        __('Au revoir');
        $this->app->terminate();

        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/pt-BR?last_refresh=');
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/zh-Hans?last_refresh=');
        // The configured list only: zh-Hans missed but is not configured, so it is not sent.
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate' && $r->data()['languages'] === ['fr', 'en', 'es']);
    }

    public function test_an_unknown_locale_is_left_alone(): void
    {
        Http::fake();
        $this->app->setLocale('xx');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->app->terminate();
        Http::assertNothingSent();
    }

    public function test_usage_is_recorded_on_a_hit_and_posted_on_terminate(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionary(),
            'https://api.test/translate' => $this->translated(['en' => 'x']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('8 hours', i18nk('8 heures', context: 'duration'));
        $this->assertSame('Au revoir', __('Au revoir'));
        $this->assertSame(0, $this->usageRequests(), 'nothing leaves before the response');
        $this->assertSame(
            ['default' => ['Bonjour' => gmdate('Y-m-d'), '8 heures__duration' => gmdate('Y-m-d'), 'Au revoir' => gmdate('Y-m-d')]],
            $this->app->make(KeylessTranslator::class)->pendingUsage()
        );

        $this->app->terminate();

        $this->assertSame(1, $this->usageRequests());
        Http::assertSent(function (Request $request) {
            return $request->method() === 'POST'
                && $request->url() === self::USAGE_URL
                && $request->hasHeader('Authorization', 'Bearer test-key')
                && $request->hasHeader('Version', ApiClient::VERSION)
                && $request->hasHeader('sdk', 'laravel')
                && ! $request->hasHeader('unique_id')
                && $request->hasHeader('Content-Type', 'application/json')
                && $request->data() === [
                    'primaryLanguage' => 'fr',
                    'translationsUsageByNamespace' => ['default' => ['Bonjour' => gmdate('Y-m-d'), '8 heures__duration' => gmdate('Y-m-d'), 'Au revoir' => gmdate('Y-m-d')]],
                ];
        });
        $this->assertSame([], $this->app->make(KeylessTranslator::class)->pendingUsage());
        $usageKey = 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':usage';
        $this->assertSame(gmdate('Y-m-d'), Cache::get($usageKey)['default']['Bonjour'], 'the map stays in the cache');
        $this->assertFalse((bool) Cache::get($usageKey.':dirty'));
    }

    public function test_usage_posts_are_throttled_to_one_every_10_seconds(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary()]);
        $this->app->setLocale('en');
        $usageKey = 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':usage';

        __('Bonjour');
        $this->app->terminate();
        $this->assertSame(1, $this->usageRequests());

        // A second request within 10 s, with a new key: merged, kept, not sent.
        __('Bienvenue :name');
        $this->app->terminate();
        $this->assertSame(1, $this->usageRequests());
        $this->assertSame(gmdate('Y-m-d'), Cache::get($usageKey)['default']['Bienvenue :name']);
        $this->assertTrue((bool) Cache::get($usageKey.':dirty'), 'the change waits for the next slot');

        // The slot frees up: the whole map leaves, with both keys.
        Cache::forget($usageKey.':lock');
        __('Bonjour');
        $this->app->terminate();
        $this->assertSame(2, $this->usageRequests());
        Http::assertSent(fn (Request $r) => $r->url() === self::USAGE_URL
            && array_keys($r->data()['translationsUsageByNamespace']['default']) === ['Bonjour', 'Bienvenue :name']);

        // Nothing changed since: a free slot sends nothing.
        Cache::forget($usageKey.':lock');
        __('Bonjour');
        $this->app->terminate();
        $this->assertSame(2, $this->usageRequests());
    }

    public function test_a_failed_usage_post_is_ignored_and_retried_later(): void
    {
        Sleep::fake();
        Http::fake([
            self::USAGE_URL => Http::sequence()->pushStatus(500)->pushStatus(500)->pushStatus(500)->push(['ok' => true, 'message' => '']),
            'https://api.test/translate/en*' => $this->dictionary(),
        ]);
        $this->app->setLocale('en');
        $usageKey = 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':usage';

        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();

        $this->assertSame(3, $this->usageRequests(), 'a 5xx is retried twice, then given up');
        $this->assertTrue((bool) Cache::get($usageKey.':dirty'), 'the map is kept for a later request');

        Cache::forget($usageKey.':lock');
        __('Bonjour');
        $this->app->terminate();
        $this->assertSame(4, $this->usageRequests());
        $this->assertFalse((bool) Cache::get($usageKey.':dirty'));
    }

    public function test_usage_can_be_disabled(): void
    {
        $this->app['config']->set('i18n-keyless.usage', false);
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary()]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame([], $this->app->make(KeylessTranslator::class)->pendingUsage());
        $this->app->terminate();

        $this->assertSame(0, $this->usageRequests());
        Http::assertNotSent(fn (Request $r) => str_contains($r->url(), 'last-used-translations'));
    }

    public function test_without_configured_languages_misses_are_not_sent_and_one_warning_is_logged(): void
    {
        $this->app['config']->set('i18n-keyless.languages', '');
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary()]);
        Log::spy();
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'), 'the dictionary is still served');
        $this->assertSame('Au revoir', __('Au revoir'), 'a miss is served as its source text');
        $this->app->terminate();
        __('Bienvenue sur la lune');
        $this->app->terminate();

        $this->assertSame(0, $this->translateRequests());
        Log::shouldHaveReceived('warning')
            ->with(\Mockery::on(fn (string $message) => str_contains($message, 'I18N_KEYLESS_LANGUAGES is required')))
            ->once();
        $this->assertSame(1, $this->dictionaryRequests());
    }

    public function test_a_line_from_lang_json_wins_over_the_api(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary()]);
        Lang::addJsonPath(__DIR__.'/../fixtures/lang');
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Welcome to our app (from the file)', __('Bienvenue sur notre app'));
        $this->assertSame('Welcome to our app (from the file)', __('Bienvenue sur notre app'));
    }

    public function test_misses_are_dispatched_to_a_job_when_a_queue_is_configured(): void
    {
        Bus::fake();
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionary([])]);
        $this->app['config']->set('i18n-keyless.queue', 'translations');
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();

        $this->assertSame(0, $this->translateRequests());
        Bus::assertDispatched(TranslateMissingKeys::class, function (TranslateMissingKeys $job) {
            return $job->queue === 'translations'
                && $job->misses === [['key' => 'Au revoir', 'context' => null, 'namespace' => 'default', 'langs' => ['en']]];
        });
    }

    public function test_the_job_posts_the_misses(): void
    {
        $this->fakeApi(['https://api.test/translate' => $this->translated(['en' => 'Goodbye'])]);

        (new TranslateMissingKeys([['key' => 'Au revoir', 'context' => null, 'namespace' => 'default', 'langs' => ['en']]]))
            ->handle($this->app->make(KeylessTranslator::class));

        $this->assertSame(1, $this->translateRequests());
        $cacheKey = 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':dict:default:en';
        $this->assertSame('Goodbye', Cache::get($cacheKey)['translations']['Au revoir']);
    }

    public function test_a_failed_post_releases_the_miss_for_a_later_request(): void
    {
        Sleep::fake();
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionary([]),
            'https://api.test/translate' => Http::response(['ok' => false, 'error' => 'boom'], 500),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();
        $this->assertSame(3, $this->translateRequests(), 'a 5xx is retried twice');

        __('Au revoir');
        $this->app->terminate();
        $this->assertSame(6, $this->translateRequests(), 'the guard was released, the next request tries again');
    }

    public function test_concurrency_is_capped_per_pool(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionary([]),
            'https://api.test/translate' => $this->translated([]),
        ]);
        $this->app['config']->set('i18n-keyless.concurrency', 2);
        $this->app->setLocale('en');

        foreach (range(1, 5) as $i) {
            __("Phrase {$i}");
        }
        $this->app->terminate();

        $this->assertSame(5, $this->translateRequests());
    }

    public function test_a_custom_namespace_is_fetched_and_posted_on_its_own(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en?last_refresh=&namespace=checkout' => $this->dictionary(['Payer' => 'Pay']),
            'https://api.test/translate/en?last_refresh=' => $this->dictionary([]),
            'https://api.test/translate' => $this->translated(['en' => 'x']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Pay', i18nk('Payer', namespace: 'checkout'));
        $this->assertSame('Panier', i18nk('Panier', namespace: 'checkout'));
        $this->app->terminate();

        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/en?last_refresh=&namespace=checkout');
        Http::assertSent(fn (Request $r) => $r->method() === 'POST' && $r->data() === ['key' => 'Panier', 'namespace' => 'checkout', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr']);
    }
}
