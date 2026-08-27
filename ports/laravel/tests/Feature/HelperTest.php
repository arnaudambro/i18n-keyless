<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

final class HelperTest extends TestCase
{
    private const EN = ['Bonjour' => 'Hello', 'Bonjour__greeting' => 'Hi there', 'Bienvenue :name' => 'Welcome :name', 'Vide__x' => ''];

    public function test_i18nk_without_a_context_is_underscore_underscore(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(self::EN)]);
        $this->app->setLocale('en');

        $this->assertSame(__('Bonjour'), i18nk('Bonjour'));
        $this->assertSame('Hello', i18nk('Bonjour'));
        $this->assertSame('Hello', i18nk('Bonjour', context: ''), 'an empty context is no context');
        $this->assertSame('Welcome Ada', i18nk('Bienvenue :name', ['name' => 'Ada']));
        $this->assertSame('Inconnu Ada', i18nk('Inconnu :name', ['name' => 'Ada']));
        $this->assertSame(['default' => ['Bonjour' => gmdate('Y-m-d'), 'Bienvenue :name' => gmdate('Y-m-d'), 'Inconnu :name' => gmdate('Y-m-d')]], $this->app->make(KeylessTranslator::class)->pendingUsage());
    }

    public function test_i18nk_with_a_context_looks_up_key_context(): void
    {
        $this->fakeApi([
            'https://api.test/translate/en*' => $this->dictionaryResponse(self::EN),
            'https://api.test/translate' => $this->translatedResponse(['en' => 'x']),
        ]);
        $this->app->setLocale('en');

        $this->assertSame('Hi there', i18nk('Bonjour', context: 'greeting'));
        $this->assertSame('Bonjour', i18nk('Bonjour', context: 'unknown'), 'the source text, never "Bonjour__unknown"');
        $this->assertSame('Vide', i18nk('Vide', context: 'x'), 'an empty translation counts as a miss');
        $this->app->terminate();

        $misses = [];
        Http::assertSent(function (Request $r) use (&$misses) {
            if ($r->method() === 'POST' && $r->url() === 'https://api.test/translate') {
                $misses[] = [$r->data()['key'], $r->data()['context'] ?? null];
            }

            return true;
        });
        $this->assertSame([['Bonjour', 'unknown'], ['Vide', 'x']], $misses);
    }

    public function test_i18nk_takes_a_locale(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(self::EN)]);
        $this->app->setLocale('fr');

        $this->assertSame('Bonjour', i18nk('Bonjour'));
        $this->assertSame('Hello', i18nk('Bonjour', locale: 'en'));
        $this->assertSame('Hi there', i18nk('Bonjour', context: 'greeting', locale: 'en'));
        $this->assertSame('Bonjour', i18nk('Bonjour', locale: 'xx'), 'an unknown locale is left alone');
        $this->assertSame('Bonjour', i18nk('Bonjour', context: 'greeting', locale: 'xx'));
        $this->assertSame(1, $this->dictionaryGets());
    }

    public function test_the_missing_key_handler_can_be_called_by_an_application_callback(): void
    {
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(self::EN)]);
        $translator = $this->app->make(KeylessTranslator::class);

        $this->assertSame('Hello', $translator->handleMissingKey('Bonjour', [], 'en', true));
        $this->assertSame('Bonjour', $translator->handleMissingKey('Bonjour', [], 'fr', true));
        $this->assertSame('Bonjour', $translator->handleMissingKey('Bonjour', [], 'xx', true));
        $this->assertSame('Au revoir', $translator->handleMissingKey('Au revoir', [], 'en', true));
        $this->assertSame('', $translator->handleMissingKey('', [], 'en', true), 'an empty key is never recorded');
        $this->assertSame(['Au revoir'], array_map(fn ($m) => $m->key, $translator->pendingMisses()));
        $this->assertSame(['Bonjour', 'Au revoir'], array_keys($translator->pendingUsage()['default']));
    }
}
