<?php

namespace I18nKeyless\Laravel\Tests\Feature;

use I18nKeyless\Laravel\Bundle;
use I18nKeyless\Laravel\I18nKeylessServiceProvider;
use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The precompiled bundle (PROTOCOL.md 7.4) through `bundle_path`: a covered
 * (namespace, lang) is read from the files, never fetched; anything else
 * behaves exactly as without a bundle.
 */
final class BundleTest extends TestCase
{
    private const CURSOR = '1757000000000';

    /** @var list<string> */
    private array $dirs = [];

    protected function tearDown(): void
    {
        foreach ($this->dirs as $dir) {
            $this->removeDir($dir);
        }
        parent::tearDown();
    }

    /**
     * Writes a bundle directory: `manifest.json` from `$namespaces` (namespace =>
     * lang => dictionary), one `<namespace>/<lang>.json` per dictionary.
     *
     * @param  array<string, array<string, array<string, string>>>  $namespaces
     */
    private function writeBundle(array $namespaces, string $cursor = self::CURSOR): string
    {
        $dir = sys_get_temp_dir().'/i18n-keyless-bundle-'.bin2hex(random_bytes(6));
        mkdir($dir, 0777, true);
        $this->dirs[] = $dir;
        $manifest = ['primaryLanguage' => 'fr', 'languages' => ['en', 'es', 'fr'], 'exportedAt' => $cursor, 'namespaces' => []];
        foreach ($namespaces as $namespace => $langs) {
            $manifest['namespaces'][$namespace] = ['lastRefresh' => $cursor, 'languages' => array_keys($langs)];
            mkdir("{$dir}/{$namespace}", 0777, true);
            foreach ($langs as $lang => $translations) {
                file_put_contents("{$dir}/{$namespace}/{$lang}.json", json_encode($translations, JSON_UNESCAPED_UNICODE));
            }
        }
        file_put_contents("{$dir}/manifest.json", json_encode($manifest));

        return $dir;
    }

    private function removeDir(string $dir): void
    {
        foreach (scandir($dir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $path = "{$dir}/{$name}";
            is_dir($path) ? $this->removeDir($path) : unlink($path);
        }
        rmdir($dir);
    }

    private function useBundle(string $dir): void
    {
        $this->app['config']->set('i18n-keyless.bundle_path', $dir);
        $this->app->forgetInstance(KeylessTranslator::class);
    }

    public function test_a_covered_pair_is_served_from_the_file_and_never_fetched(): void
    {
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello', 'Merci' => 'Thanks'], 'es' => ['Bonjour' => 'Hola']]]);
        $this->useBundle($dir);
        $this->fakeApi(['https://api.test/*' => $this->dictionaryResponse(['Bonjour' => 'From the API'])]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Thanks', i18nk('Merci'));
        $this->app->setLocale('es');
        $this->assertSame('Hola', __('Bonjour'));
        $this->app->terminate();

        $this->assertSame(0, $this->dictionaryGets(), 'a covered pair is read, not fetched');
        $this->assertSame(0, $this->translatePosts());
        // The slice is persisted with the manifest's cursor, fresh, without an ETag.
        $entry = Cache::get($this->dictKey('en'));
        $this->assertSame(['Bonjour' => 'Hello', 'Merci' => 'Thanks'], $entry['translations']);
        $this->assertSame(self::CURSOR, $entry['last_refresh']);
        $this->assertNull($entry['etag']);
        $this->assertFalse($this->app->make(KeylessTranslator::class)->bundle() === null);
    }

    public function test_a_pair_the_manifest_does_not_cover_is_still_fetched(): void
    {
        // `checkout` lists only `en`; `es` and the `chat` namespace are not in the bundle.
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello']], 'checkout' => ['en' => ['Panier' => 'Cart']]]);
        $this->useBundle($dir);
        $this->fakeApi([
            'https://api.test/translate/es?last_refresh=' => $this->dictionaryResponse(['Bonjour' => 'Hola']),
            'https://api.test/translate/es?last_refresh=&namespace=checkout' => $this->dictionaryResponse(['Panier' => 'Carrito']),
            'https://api.test/translate/en?last_refresh=&namespace=chat' => $this->dictionaryResponse(['Salut' => 'Hi']),
        ]);

        $this->app->setLocale('en');
        $this->assertSame('Cart', i18nk('Panier', namespace: 'checkout'));
        $this->assertSame('Hi', i18nk('Salut', namespace: 'chat'));
        $this->app->setLocale('es');
        $this->assertSame('Hola', __('Bonjour'));
        $this->assertSame('Carrito', i18nk('Panier', namespace: 'checkout'));

        $this->assertSame(3, $this->dictionaryGets());
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/es?last_refresh=');
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/es?last_refresh=&namespace=checkout');
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/en?last_refresh=&namespace=chat');
        Http::assertNotSent(fn (Request $r) => $r->url() === 'https://api.test/translate/en?last_refresh=');
        Http::assertNotSent(fn (Request $r) => $r->url() === 'https://api.test/translate/en?last_refresh=&namespace=checkout');
    }

    public function test_a_miss_still_posts_and_its_answer_is_merged_next_to_the_bundle(): void
    {
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello']]]);
        $this->useBundle($dir);
        $this->fakeApi(['https://api.test/translate' => $this->translatedResponse(['fr' => 'Au revoir', 'en' => 'Goodbye', 'es' => 'Adiós'])]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Au revoir', __('Au revoir'), 'a miss returns the source text');
        $this->app->terminate();

        $this->assertSame(0, $this->dictionaryGets());
        $this->assertSame(1, $this->translatePosts());
        Http::assertSent(fn (Request $r) => $r->method() === 'POST'
            && $r->data() === ['key' => 'Au revoir', 'languages' => ['fr', 'en', 'es'], 'primaryLanguage' => 'fr']);
        $entry = Cache::get($this->dictKey('en'));
        $this->assertSame(['Bonjour' => 'Hello', 'Au revoir' => 'Goodbye'], $entry['translations']);
        $this->assertSame(self::CURSOR, $entry['last_refresh'], 'a POST answer does not move the cursor');
        // The running process has it too.
        $this->assertSame('Goodbye', __('Au revoir'));
    }

    public function test_a_cache_newer_than_the_bundle_keeps_its_text_and_its_cursor(): void
    {
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello', 'Merci' => 'Thanks']]]);
        $this->useBundle($dir);
        Cache::forever($this->dictKey('en'), [
            'translations' => ['Bonjour' => 'Hello there'],
            'etag' => 'W/"reviewed"',
            'fetched_at' => time(),
            'failed' => false,
            'last_refresh' => '1757000600000',
        ]);
        $this->fakeApi([]);
        $this->app->setLocale('en');

        $this->assertSame('Hello there', __('Bonjour'), 'the reviewed text of a fresher cache wins');
        $this->assertSame('Thanks', __('Merci'), 'a key only the bundle has is merged underneath');
        $this->app->terminate();

        $this->assertSame(0, $this->dictionaryGets());
        $entry = Cache::get($this->dictKey('en'));
        $this->assertSame('1757000600000', $entry['last_refresh']);
        $this->assertSame('W/"reviewed"', $entry['etag'], 'the cache keeps its ETag when it wins');
    }

    public function test_a_cache_older_than_the_bundle_is_overwritten_but_keeps_its_extra_keys(): void
    {
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello']]]);
        $this->useBundle($dir);
        Cache::forever($this->dictKey('en'), [
            'translations' => ['Bonjour' => 'Old hello', 'Au revoir' => 'Goodbye'],
            'etag' => 'W/"old"',
            'fetched_at' => 0,
            'failed' => false,
            'last_refresh' => '1756000000000',
        ]);
        $this->fakeApi([]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame('Goodbye', __('Au revoir'));
        $this->app->terminate();

        $this->assertSame(0, $this->dictionaryGets(), 'seeded fresh: no revalidation either');
        $entry = Cache::get($this->dictKey('en'));
        $this->assertSame(self::CURSOR, $entry['last_refresh']);
        $this->assertNull($entry['etag']);
    }

    public function test_a_cache_without_a_cursor_never_outranks_the_bundle(): void
    {
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello']]]);
        $this->useBundle($dir);
        // An entry written by a version of the package that kept no cursor.
        Cache::forever($this->dictKey('en'), ['translations' => ['Bonjour' => 'Stale'], 'etag' => 'W/"1"', 'fetched_at' => time(), 'failed' => false]);
        $this->fakeApi([]);
        $this->app->setLocale('en');

        $this->assertSame('Hello', __('Bonjour'));
        $this->assertSame(0, $this->dictionaryGets());
    }

    public function test_a_missing_dictionary_file_falls_back_to_the_fetch(): void
    {
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello']]]);
        unlink("{$dir}/default/en.json");
        $this->useBundle($dir);
        Log::spy();
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'From the API'])]);
        $this->app->setLocale('en');

        $this->assertSame('From the API', __('Bonjour'));
        $this->assertSame(1, $this->dictionaryGets());
        Log::shouldHaveReceived('warning')
            ->with(\Mockery::on(fn (string $message) => str_contains($message, 'bundle file') && str_contains($message, 'default/en')))
            ->once();
    }

    public function test_a_bundle_path_without_a_manifest_is_ignored_with_one_warning(): void
    {
        Log::spy();
        $this->useBundle(sys_get_temp_dir().'/i18n-keyless-no-such-bundle-'.bin2hex(random_bytes(4)));
        $this->fakeApi(['https://api.test/translate/en*' => $this->dictionaryResponse(['Bonjour' => 'From the API'])]);
        $this->app->setLocale('en');

        $this->assertNull($this->app->make(KeylessTranslator::class)->bundle());
        $this->assertSame('From the API', __('Bonjour'));
        $this->assertSame(1, $this->dictionaryGets());
        Log::shouldHaveReceived('warning')
            ->with(\Mockery::on(fn (string $message) => str_contains($message, 'manifest.json')))
            ->once();
    }

    public function test_without_bundle_path_there_is_no_bundle(): void
    {
        $this->assertNull(I18nKeylessServiceProvider::makeTranslator($this->app)->bundle());
        $this->assertNull(Bundle::fromPath(null));
        $this->assertNull(Bundle::fromPath(''));
    }

    public function test_the_bundle_exposes_its_manifest(): void
    {
        $dir = $this->writeBundle(['default' => ['en' => ['Bonjour' => 'Hello'], 'fr' => ['Bonjour' => 'Bonjour']], 'checkout' => ['en' => []]]);
        $bundle = Bundle::fromPath($dir.'/');

        $this->assertNotNull($bundle);
        $this->assertSame($dir, $bundle->path());
        $this->assertSame(['default', 'checkout'], $bundle->namespaces());
        $this->assertSame(self::CURSOR, $bundle->lastRefresh('default'));
        $this->assertNull($bundle->lastRefresh('chat'));
        $this->assertTrue($bundle->covers('default', 'fr'));
        $this->assertFalse($bundle->covers('checkout', 'fr'));
        $this->assertSame(['translations' => ['Bonjour' => 'Hello'], 'lastRefresh' => self::CURSOR], $bundle->seed('default', 'en'));
        $this->assertSame(['translations' => [], 'lastRefresh' => self::CURSOR], $bundle->seed('checkout', 'en'));
        $this->assertNull($bundle->seed('checkout', 'fr'));
    }
}
