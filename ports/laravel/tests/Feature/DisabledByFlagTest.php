<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\I18nKeylessServiceProvider;
use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Support\Facades\Http;

final class DisabledByFlagTest extends TestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);
        $app['config']->set('i18n-keyless.enabled', false);
    }

    public function test_enabled_false_switches_the_package_off_even_with_an_api_key(): void
    {
        Http::fake();
        $this->assertFalse(I18nKeylessServiceProvider::enabled($this->app));
        $this->assertTrue($this->app->bound(KeylessTranslator::class), 'the singleton stays bound, the hooks do not');
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame('Bonjour Ada', __('Bonjour :name', ['name' => 'Ada']));
        $this->assertSame('8 heures', i18nk('8 heures', context: 'duration'));
        $this->assertSame('8 heures Ada', i18nk('8 heures :name', ['name' => 'Ada'], context: 'duration'));
        $this->app->terminate();

        $this->assertFalse($this->app->resolved(KeylessTranslator::class), 'i18nk() falls back to __() without touching the package');
        Http::assertNothingSent();
    }
}
