<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Support\Facades\Http;

final class DisabledTest extends TestCase
{
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);
        $app['config']->set('i18n-keyless.api_key', null);
    }

    public function test_without_an_api_key_laravel_behaves_as_before(): void
    {
        Http::fake();
        $this->app->setLocale('en');

        $this->assertSame('Bonjour', __('Bonjour'));
        $this->assertSame('Bonjour Ada', __('Bonjour :name', ['name' => 'Ada']));
        $this->assertSame('8 heures', i18nk('8 heures', context: 'duration'));
        $this->app->terminate();

        Http::assertNothingSent();
    }
}
