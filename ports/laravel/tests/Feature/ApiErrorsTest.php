<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;

/** The answers of POST /translate and of the usage route that are not a clean 200 { ok: true }. */
final class ApiErrorsTest extends TestCase
{
    private function missKey(string $id): string
    {
        return 'i18n-keyless:'.substr(sha1('test-key'), 0, 8).':miss:'.sha1($id);
    }

    public function test_an_unparsable_200_on_translate_is_retried_like_a_5xx(): void
    {
        Sleep::fake();
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => Http::sequence()->push('{not json', 200)->push('', 200)->push(['ok' => true, 'data' => ['translation' => ['en' => 'Goodbye']], 'error' => '', 'message' => '']),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();

        $this->assertSame(3, $this->translatePosts());
        Sleep::assertSequence([Sleep::for(500)->milliseconds(), Sleep::for(1500)->milliseconds()]);
        $this->assertSame('Goodbye', Cache::get($this->dictKey('en'))['translations']['Au revoir']);
    }

    public function test_an_unparsable_200_on_every_attempt_gives_up_and_releases_the_miss(): void
    {
        Sleep::fake();
        Log::spy();
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => Http::response('{not json', 200),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();

        $this->assertSame(3, $this->translatePosts());
        $this->assertNull(Cache::get($this->missKey('default:Au revoir')), 'released for a later request');
        Log::shouldHaveReceived('warning')->with('i18n-keyless: translate error for "Au revoir": invalid JSON')->once();
    }

    public function test_a_4xx_on_translate_is_not_retried_and_releases_the_miss(): void
    {
        Sleep::fake();
        Log::spy();
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => Http::response(['ok' => false, 'error' => 'Unauthorized'], 401),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();

        $this->assertSame(1, $this->translatePosts());
        Sleep::assertNeverSlept();
        $this->assertNull(Cache::get($this->missKey('default:Au revoir')));
        Log::shouldHaveReceived('warning')->with('i18n-keyless: translate error for "Au revoir": Unauthorized')->once();

        __('Au revoir');
        $this->app->terminate();
        $this->assertSame(2, $this->translatePosts(), 'the next request tries again');
    }

    public function test_a_200_with_ok_false_on_translate_is_a_failure(): void
    {
        Log::spy();
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => Http::response(['ok' => false, 'error' => 'quota exceeded', 'message' => '']),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();

        $this->assertSame(1, $this->translatePosts());
        $this->assertNull(Cache::get($this->missKey('default:Au revoir')));
        $this->assertArrayNotHasKey('Au revoir', Cache::get($this->dictKey('en'))['translations']);
        Log::shouldHaveReceived('warning')->with('i18n-keyless: translate error for "Au revoir": quota exceeded')->once();
    }

    public function test_a_200_with_ok_false_and_no_error_says_not_ok(): void
    {
        Log::spy();
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => Http::response(['data' => []]),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();

        Log::shouldHaveReceived('warning')->with('i18n-keyless: translate error for "Au revoir": not ok')->once();
    }

    public function test_a_message_from_the_api_is_logged_and_a_non_map_translation_is_ignored(): void
    {
        Log::spy();
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => Http::response(['ok' => true, 'data' => ['translation' => 'oops'], 'error' => '', 'message' => 'Your plan ends soon']),
        ]);
        $this->app->setLocale('en');

        __('Au revoir');
        $this->app->terminate();

        Log::shouldHaveReceived('warning')->with('i18n-keyless: Your plan ends soon')->once();
        $this->assertSame([], Cache::get($this->dictKey('en'))['translations']);
        $this->assertNotNull(Cache::get($this->missKey('default:Au revoir')), 'a successful call keeps its claim');
    }

    public function test_a_stray_request_error_inside_the_pool_fails_the_chunk_without_throwing(): void
    {
        Sleep::fake();
        Log::spy();
        Http::preventStrayRequests();
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse([])]);
        $this->app->setLocale('en');

        __('Au revoir');
        __('À bientôt');
        $this->app->terminate();

        $this->assertSame(0, $this->translatePosts());
        Sleep::assertNeverSlept();
        $this->assertNull(Cache::get($this->missKey('default:Au revoir')));
        $this->assertNull(Cache::get($this->missKey('default:À bientôt')));
        Log::shouldHaveReceived('warning')
            ->with(\Mockery::on(fn (string $m) => str_starts_with($m, 'i18n-keyless: translate error for "Au revoir": ') && str_contains($m, 'https://api.test/translate')))
            ->once();
        Log::shouldHaveReceived('warning')
            ->with(\Mockery::on(fn (string $m) => str_starts_with($m, 'i18n-keyless: translate error for "À bientôt": ')))
            ->once();
    }

    public function test_a_body_that_cannot_be_encoded_fails_the_whole_chunk_without_throwing(): void
    {
        Sleep::fake();
        Log::spy();
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse([])]);
        $this->app->setLocale('en');

        // Latin-1 bytes: not valid UTF-8, so the JSON body cannot be built and the pool throws before any request leaves.
        $broken = "Caf\xE9 au lait";
        $this->assertSame($broken, __($broken));
        $this->assertSame('Au revoir', __('Au revoir'));
        $this->app->terminate();

        $this->assertSame(0, $this->translatePosts());
        Sleep::assertNeverSlept();
        $this->assertNull(Cache::get($this->missKey('default:Au revoir')), 'every miss of the chunk is released');
        $this->assertNull(Cache::get($this->missKey("default:{$broken}")));
        Log::shouldHaveReceived('warning')
            ->with(\Mockery::on(fn (string $m) => str_starts_with($m, 'i18n-keyless: translate error for "Au revoir": ') && str_contains($m, 'UTF-8')))
            ->once();
    }

    public function test_a_usage_post_answered_ok_false_keeps_the_map_dirty(): void
    {
        Log::spy();
        Http::fake([
            self::USAGE_URL => Http::response(['ok' => false, 'error' => 'quota exceeded', 'message' => 'Your plan ends soon']),
            'https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();

        $this->assertSame(1, $this->usageRequests());
        $this->assertTrue((bool) Cache::get($this->usageKey().':dirty'));
        Log::shouldHaveReceived('warning')->with('i18n-keyless: Your plan ends soon')->once();
        Log::shouldHaveReceived('warning')->with('i18n-keyless: send translations usage error: quota exceeded')->once();
    }

    public function test_a_usage_post_answered_without_ok_says_not_ok_and_a_4xx_is_not_retried(): void
    {
        Sleep::fake();
        Log::spy();
        Http::fake([
            self::USAGE_URL => Http::sequence()->push(['message' => ''])->pushStatus(403),
            'https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello']),
        ]);
        $this->app->setLocale('en');

        __('Bonjour');
        $this->app->terminate();
        Log::shouldHaveReceived('warning')->with('i18n-keyless: send translations usage error: not ok')->once();

        Cache::forget($this->usageKey().':lock');
        __('Bonjour');
        $this->app->terminate();

        $this->assertSame(2, $this->usageRequests());
        Sleep::assertNeverSlept();
        Log::shouldHaveReceived('warning')->with('i18n-keyless: send translations usage error: Forbidden')->once();
        $this->assertTrue((bool) Cache::get($this->usageKey().':dirty'));
    }

    public function test_a_dictionary_with_ok_false_or_a_message_is_handled(): void
    {
        Log::spy();
        $this->fakeApi([
            'https://api.test/translate/en*' => Http::response(['ok' => false, 'error' => 'Unknown API key', 'message' => '']),
            'https://api.test/translate/es*' => Http::response(['ok' => true, 'data' => ['translations' => ['Bonjour' => 'Hola', 'Vide' => null, 'Nombre' => 3]], 'error' => '', 'message' => 'Your plan ends soon']),
        ]);

        $this->app->setLocale('en');
        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertTrue(Cache::get($this->dictKey('en'))['failed']);

        $this->app->setLocale('es');
        $this->assertSame('Hola', __('Bonjour'));
        $this->assertSame(['Bonjour' => 'Hola'], Cache::get($this->dictKey('es'))['translations'], 'non-string lines are dropped');

        Log::shouldHaveReceived('warning')->with('i18n-keyless: fetch all translations error: Unknown API key')->once();
        Log::shouldHaveReceived('warning')->with('i18n-keyless: Your plan ends soon')->once();
        $misses = array_map(fn ($m) => $m->toArray(), $this->app->make(KeylessTranslator::class)->pendingMisses());
        $this->assertSame([['key' => 'Bonjour', 'context' => null, 'namespace' => 'default', 'langs' => ['en']]], $misses, 'after a failed fetch the key is a miss for that language only');
    }
}
