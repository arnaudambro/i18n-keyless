<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\Jobs\TranslateMissingKeys;
use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

final class QueueTest extends TestCase
{
    public function test_on_the_sync_connection_the_job_runs_at_once_and_the_answer_is_cached(): void
    {
        $this->app['config']->set('i18n-keyless.queue', 'translations');
        $this->fakeApi([
            'https://api.test/translate/*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => $this->translatedResponse(['fr' => 'Au revoir', 'en' => 'Goodbye', 'es' => 'Adiós']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Au revoir', __('Au revoir'));
        $this->assertSame(0, $this->translatePosts());
        $this->app->terminate();

        $this->assertSame(1, $this->translatePosts());
        Http::assertSent(fn (Request $r) => $r->method() === 'POST' && $r->data() === ['key' => 'Au revoir', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr']);
        $this->assertSame('Goodbye', Cache::get($this->dictKey('en'))['translations']['Au revoir']);
        $this->assertSame('Adiós', Cache::get($this->dictKey('es'))['translations']['Au revoir']);
        $this->assertArrayNotHasKey('fr', array_flip(array_keys(array_filter([Cache::get($this->dictKey('fr'))]))), 'the primary is never stored');
        // The worker process picks the line up too.
        $this->assertSame('Goodbye', __('Au revoir'));
        $this->assertSame(1, $this->translatePosts());
    }

    public function test_a_job_without_misses_sends_nothing(): void
    {
        $this->fakeApi([]);

        (new TranslateMissingKeys([]))->handle($this->app->make(KeylessTranslator::class));
        $this->app->make(KeylessTranslator::class)->translateNow([]);

        Http::assertNothingSent();
    }

    public function test_a_job_without_configured_languages_sends_nothing_and_warns_once(): void
    {
        $this->app['config']->set('i18n-keyless.languages', '');
        $this->fakeApi([]);
        Log::spy();
        $misses = [['key' => 'Au revoir', 'context' => null, 'namespace' => 'default', 'langs' => ['en']]];

        (new TranslateMissingKeys($misses))->handle($this->app->make(KeylessTranslator::class));
        (new TranslateMissingKeys($misses))->handle($this->app->make(KeylessTranslator::class));

        Http::assertNothingSent();
        Log::shouldHaveReceived('warning')
            ->with(\Mockery::on(fn (string $message) => str_contains($message, 'I18N_KEYLESS_LANGUAGES is required')))
            ->once();
    }

    public function test_the_job_carries_the_context_and_the_namespace(): void
    {
        $this->fakeApi(['https://api.test/translate' => $this->translatedResponse(['en' => '8 AM', 'es' => '8 AM'])]);

        (new TranslateMissingKeys([['key' => '8 heures', 'context' => 'clock time', 'namespace' => 'checkout', 'langs' => ['en']]]))
            ->handle($this->app->make(KeylessTranslator::class));

        Http::assertSent(fn (Request $r) => $r->data() === ['key' => '8 heures', 'context' => 'clock time', 'namespace' => 'checkout', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr']);
        $this->assertSame('8 AM', Cache::get($this->dictKey('en', 'checkout'))['translations']['8 heures__clock time']);
        $this->assertSame('8 AM', Cache::get($this->dictKey('es', 'checkout'))['translations']['8 heures__clock time']);
    }
}
