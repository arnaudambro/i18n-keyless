<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\I18nKeylessServiceProvider;
use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;

final class ConfigTest extends TestCase
{
    private function translator(): KeylessTranslator
    {
        return I18nKeylessServiceProvider::makeTranslator($this->app);
    }

    public function test_the_test_environment_config_is_read(): void
    {
        $translator = $this->translator();

        $this->assertSame('fr', $translator->primary());
        $this->assertSame(['fr', 'en', 'es'], $translator->languages());
        $this->assertSame('default', $translator->defaultNamespace());
        $this->assertTrue($translator->usageEnabled());
        $this->assertSame([], $translator->pendingMisses());
        $this->assertSame([], $translator->pendingUsage());
    }

    public function test_the_primary_falls_back_to_the_app_locale_then_to_en(): void
    {
        $this->app['config']->set('i18n-keyless.primary', null);
        $this->app['config']->set('app.locale', 'pt_BR');
        $this->assertSame('pt-BR', $this->translator()->primary());

        $this->app['config']->set('i18n-keyless.primary', 'xx');
        $this->assertSame('pt-BR', $this->translator()->primary(), 'an unknown primary is ignored');

        $this->app['config']->set('app.locale', 'xx');
        $this->assertSame('en', $this->translator()->primary());
    }

    public function test_languages_accept_a_list_or_a_string_and_drop_what_is_not_a_language(): void
    {
        $this->app['config']->set('i18n-keyless.languages', ['en', 'pt_BR', 42, null, 'xx', 'EN', '']);
        $this->assertSame(['en', 'pt-BR'], $this->translator()->languages());

        $this->app['config']->set('i18n-keyless.languages', ' en , zh_CN,cz,, es-419 ');
        $this->assertSame(['en', 'zh-Hans', 'es-MX'], $this->translator()->languages());

        $this->app['config']->set('i18n-keyless.languages', 7);
        $this->assertSame([], $this->translator()->languages());

        $this->app['config']->set('i18n-keyless.languages', null);
        $this->assertSame([], $this->translator()->languages());
    }

    public function test_namespace_and_usage_are_normalized(): void
    {
        $this->app['config']->set('i18n-keyless.namespace', '');
        $this->app['config']->set('i18n-keyless.usage', '0');
        $translator = $this->translator();

        $this->assertSame('default', $translator->defaultNamespace());
        $this->assertFalse($translator->usageEnabled());

        $this->app['config']->set('i18n-keyless.namespace', 'checkout');
        $this->assertSame('checkout', $this->translator()->defaultNamespace());
    }

    public function test_the_api_url_loses_its_trailing_slash_and_an_empty_one_means_the_official_service(): void
    {
        $this->app['config']->set('i18n-keyless.api_url', 'https://proxy.test/i18n/');
        Http::fake(['*' => $this->dictionaryResponse(['Bonjour' => 'Hello'])]);
        $this->app->setLocale('en');
        $this->assertSame('Hello', __('Bonjour'));
        Http::assertSent(fn (Request $r) => $r->url() === 'https://proxy.test/i18n/translate/en?last_refresh=');

        $this->app['config']->set('i18n-keyless.api_url', '/');
        $this->app->forgetInstance(KeylessTranslator::class);
        Cache::flush();
        $this->assertSame('Hello', __('Bonjour'));
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.i18n-keyless.com/translate/en?last_refresh=');
    }

    public function test_a_malformed_retry_list_falls_back_to_the_default_backoff(): void
    {
        Sleep::fake();
        $this->app['config']->set('i18n-keyless.retry', 'nope');
        $this->fakeApi(['https://api.test/translate/en*' => Http::response('down', 503)]);
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame(3, $this->dictionaryGets());
        Sleep::assertSequence([Sleep::for(500)->milliseconds(), Sleep::for(1500)->milliseconds()]);
    }

    public function test_a_custom_retry_list_drives_the_backoff(): void
    {
        Sleep::fake();
        $this->app['config']->set('i18n-keyless.retry', ['100']);
        $this->fakeApi(['https://api.test/translate/en*' => Http::response('down', 503)]);
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame(2, $this->dictionaryGets(), 'one entry: two attempts');
        Sleep::assertSequence([Sleep::for(100)->milliseconds()]);
    }

    public function test_a_custom_cache_store_holds_every_key(): void
    {
        $this->app['config']->set('cache.stores.i18n', ['driver' => 'array']);
        $this->app['config']->set('i18n-keyless.cache.store', 'i18n');
        $this->app['config']->set('i18n-keyless.cache.prefix', 'kl');
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello']),
            'https://api.test/translate' => $this->translatedResponse(['en' => 'Goodbye']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Au revoir', __('Au revoir'));
        $this->app->terminate();

        $hash = substr(sha1('test-key'), 0, 8);
        $custom = Cache::store('i18n');
        $this->assertSame('Hello', $custom->get("kl:{$hash}:dict:default:en")['translations']['Bonjour']);
        $this->assertSame('Goodbye', $custom->get("kl:{$hash}:dict:default:en")['translations']['Au revoir']);
        $this->assertSame(gmdate('Y-m-d'), $custom->get("kl:{$hash}:usage")['default']['Bonjour']);
        $this->assertNull(Cache::get("kl:{$hash}:dict:default:en"), 'nothing lands in the default store');
        $this->assertNull(Cache::get($this->dictKey('en')));
    }

    public function test_a_different_api_key_gets_its_own_cache_namespace(): void
    {
        $this->app['config']->set('i18n-keyless.api_key', 'other-key');
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello'])]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));

        $this->assertNotNull(Cache::get($this->dictKey('en', apiKey: 'other-key')));
        $this->assertNull(Cache::get($this->dictKey('en')));
    }
}
