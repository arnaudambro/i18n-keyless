<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\Tests\Support\FlakyArrayStore;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;

/** Failures around the API call (the logger, the cache, a revalidation) never reach the page. */
final class ResilienceTest extends TestCase
{
    public function test_a_logger_failure_never_takes_a_translation_down(): void
    {
        Sleep::fake();
        $this->app['config']->set('i18n-keyless.languages', '');
        Log::shouldReceive('warning')->zeroOrMoreTimes()->andThrow(new \RuntimeException('the log channel is down'));
        $this->fakeApi(['https://api.test/translate/en*' => Http::response(['ok' => false, 'error' => 'Unauthorized'], 401)]);
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame('Au revoir', __('Au revoir'));
        $this->app->terminate();
        __('Bonjour');
        $this->app->terminate();

        $this->assertSame(1, $this->dictionaryGets());
        $this->assertSame(0, $this->translatePosts());
        $this->assertSame(1, $this->usageRequests(), 'usage still leaves');
    }

    public function test_a_cache_failure_on_the_usage_map_never_takes_a_translation_down(): void
    {
        Cache::extend('flaky', fn ($app, array $config) => Cache::repository(new FlakyArrayStore($config['failing'])));
        $this->app['config']->set('cache.stores.flaky', ['driver' => 'flaky', 'failing' => ':usage']);
        $this->app['config']->set('i18n-keyless.cache.store', 'flaky');
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello']),
            'https://api.test/translate' => $this->translatedResponse(['en' => 'Goodbye']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Au revoir', __('Au revoir'));
        $this->app->terminate();

        $this->assertSame(1, $this->translatePosts(), 'the dictionary keys work, the misses are sent');
        $this->assertSame(0, $this->usageRequests(), 'the usage map could not be read: nothing is sent, nothing thrown');
        $this->assertSame('Goodbye', Cache::store('flaky')->get($this->dictKey('en'))['translations']['Au revoir']);
        $this->assertSame('Goodbye', __('Au revoir'));
    }

    public function test_a_cache_failure_on_the_usage_lock_is_swallowed_too(): void
    {
        Cache::extend('flaky', fn ($app, array $config) => Cache::repository(new FlakyArrayStore($config['failing'])));
        $this->app['config']->set('cache.stores.flaky', ['driver' => 'flaky', 'failing' => ':usage:lock']);
        $this->app['config']->set('i18n-keyless.cache.store', 'flaky');
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello'])]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();

        $this->assertSame(0, $this->usageRequests());
        $this->assertTrue((bool) Cache::store('flaky')->get($this->usageKey().':dirty'), 'the change waits for a later request');
    }

    public function test_a_malformed_cache_entry_is_refetched(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello'])]);
        Cache::forever($this->dictKey('en'), 'garbage');
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));

        $this->assertSame(1, $this->dictionaryGets());
        $this->assertSame(['Bonjour' => 'Hello'], Cache::get($this->dictKey('en'))['translations']);
    }

    public function test_a_failed_revalidation_keeps_the_stale_dictionary_and_remembers_the_failure(): void
    {
        Sleep::fake();
        Log::spy();
        $this->fakeApi(['https://api.test/translate/en' => Http::response('down', 503)]);
        Cache::forever($this->dictKey('en'), ['translations' => ['Bonjour' => 'Hello'], 'etag' => 'W/"abc"', 'fetched_at' => 0, 'failed' => false]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();

        $this->assertSame(3, $this->dictionaryGets());
        $entry = Cache::get($this->dictKey('en'));
        $this->assertSame(['Bonjour' => 'Hello'], $entry['translations']);
        $this->assertSame('W/"abc"', $entry['etag'], 'the ETag is kept for the next revalidation');
        $this->assertTrue($entry['failed']);
        $this->assertGreaterThan(0, $entry['fetched_at'], 'the failure is remembered for a while');
        Log::shouldHaveReceived('warning')->with('i18n-keyless: fetch all translations error: Service Unavailable')->once();

        // The next request still serves the stale lines and does not retry at once.
        $this->app->forgetInstance(\I18nKeyless\Laravel\KeylessTranslator::class);
        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();
        $this->assertSame(3, $this->dictionaryGets());
    }

    public function test_a_failed_revalidation_of_a_dictionary_that_vanished_from_the_cache_stores_a_failed_entry(): void
    {
        Sleep::fake();
        $this->fakeApi(['https://api.test/translate/en*' => Http::response('down', 503)]);
        Cache::forever($this->dictKey('en'), ['translations' => ['Bonjour' => 'Hello'], 'etag' => null, 'fetched_at' => 0, 'failed' => false]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        Cache::forget($this->dictKey('en'));
        $this->app->terminate();

        $entry = Cache::get($this->dictKey('en'));
        $this->assertSame([], $entry['translations']);
        $this->assertTrue($entry['failed']);
    }
}
