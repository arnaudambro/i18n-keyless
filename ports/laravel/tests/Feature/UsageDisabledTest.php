<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Lang;

/** With `usage` off the dictionary is injected with `Lang::addLines()` instead of the miss handler. */
final class UsageDisabledTest extends TestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);
        $app['config']->set('i18n-keyless.usage', false);
    }

    public function test_the_dictionary_is_injected_into_the_translator(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'Hello', 'Vide' => '', 'Bonjour. Ça va ?' => 'Hello. How are you?'])]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertTrue(Lang::has('Bonjour', 'en'), 'a plain key is an addLines line');
        $this->assertSame('Hello. How are you?', __('Bonjour. Ça va ?'), 'a key with a dot goes through the miss handler');
        $this->assertSame('Vide', __('Vide'), 'an empty translation is not injected');
        $this->app->terminate();

        $this->assertSame(0, $this->usageRequests());
        $this->assertSame([], $this->app->make(KeylessTranslator::class)->pendingUsage());
        $this->assertNull(Cache::get($this->usageKey()));
    }

    public function test_an_empty_dictionary_injects_nothing_and_a_translated_miss_is_injected_after_the_response(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse([]),
            'https://api.test/translate' => $this->translatedResponse(['en' => 'Goodbye', 'es' => 'Adiós', 'fr' => 'Au revoir', 'xx' => 'nope', 'de' => '']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Au revoir', __('Au revoir'));
        $this->assertFalse(Lang::has('Au revoir', 'en'));
        $this->app->terminate();

        $this->assertSame(1, $this->translatePosts());
        $this->assertTrue(Lang::has('Au revoir', 'en'), 'the running process picks the new line up');
        $this->assertSame('Goodbye', __('Au revoir'));
        $this->assertSame('Adiós', Cache::get($this->dictKey('es'))['translations']['Au revoir']);
        $this->assertNull(Cache::get($this->dictKey('fr')), 'the primary is never stored');
        $this->assertNull(Cache::get($this->dictKey('xx')), 'an unknown language is dropped');
        $this->assertNull(Cache::get($this->dictKey('de')), 'an empty translation is dropped');
        $this->assertSame(0, $this->usageRequests());
    }

    public function test_a_revalidation_refreshes_the_injected_lines(): void
    {
        $this->fakeApi(['https://api.test/translate/en' => $this->dictionaryResponse(['Bonjour' => 'Hi'], 'W/"2"')]);
        Cache::forever($this->dictKey('en'), ['translations' => ['Bonjour' => 'Hello'], 'etag' => 'W/"1"', 'fetched_at' => 0, 'failed' => false]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();

        $this->assertSame('Hi', __('Bonjour'));
        $this->assertSame('W/"2"', Cache::get($this->dictKey('en'))['etag']);
    }

    public function test_a_line_from_lang_json_still_wins(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(['Bienvenue sur notre app' => 'Welcome (from the API)', 'Bonjour' => 'Hello'])]);
        Lang::addJsonPath(__DIR__.'/../fixtures/lang');
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Welcome to our app (from the file)', __('Bienvenue sur notre app'));
    }
}
