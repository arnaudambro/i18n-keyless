<?php

namespace I18nKeyless\Laravel\Tests\Conformance;

use I18nKeyless\Laravel\ApiClient;
use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Locale;
use I18nKeyless\Laravel\Miss;
use I18nKeyless\Laravel\Tests\TestCase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;

/**
 * Replays the shared conformance vectors of the monorepo (conformance/vectors/*.json).
 *
 * Not replayed, on purpose: replace.json (placeholders are Laravel's `:name`),
 * storage-keys.json and unique-id.json cases (a device storage contract; a server
 * sends no id), the usage-*.json device and custom-handler cases, the
 * forceTemporary / originLanguage / custom-handler cases (not exposed by this
 * package), and the queue id rule (this package dedupes by key AND context).
 */
final class VectorsTest extends TestCase
{
    private const VECTORS = __DIR__.'/../../../../conformance/vectors';

    /** @return array<string, mixed> */
    private function vector(string $name): array
    {
        $path = self::VECTORS."/{$name}.json";
        if (! is_file($path)) {
            $this->markTestSkipped("no conformance vector at {$path}");
        }

        return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }

    public function test_resolve_lang(): void
    {
        foreach ($this->vector('resolve-lang')['cases'] as $case) {
            $input = $case['input'];
            $this->assertSame(
                $case['expected'],
                Locale::resolve($input['tag'], $input['supported'] ?? null, $input['fallback'] ?? null),
                $case['name']
            );
        }
    }

    public function test_languages(): void
    {
        foreach ($this->vector('languages')['cases'] as $case) {
            switch ($case['check']) {
                case 'availableLangs':
                    $this->assertSame($case['expected'], Locale::AVAILABLE_LANGS, $case['name']);
                    break;
                case 'rename':
                    // No v2 dialect in this package: the v2 code is simply not a language.
                    $this->assertNull(Locale::toLang($case['input']), $case['name']);
                    $this->assertTrue(Locale::isLang($case['expected']), $case['name']);
                    break;
                case 'stillAvailable':
                    foreach ($case['input'] as $code) {
                        $this->assertTrue(Locale::isLang($code), $case['name']);
                    }
                    break;
                case 'absent':
                    $this->assertFalse(Locale::isLang($case['input']), $case['name']);
                    break;
                case 'regionalized':
                    $regionalized = array_values(array_filter(Locale::AVAILABLE_LANGS, fn ($code) => str_contains($code, '-')));
                    sort($regionalized);
                    $this->assertSame($case['expected'], $regionalized, $case['name']);
                    break;
                default:
                    $this->fail("unknown check {$case['check']}");
            }
        }
    }

    public function test_app_store_locales(): void
    {
        $vector = $this->vector('app-store-locales');
        foreach ($vector['cases'] as $case) {
            $this->assertSame($case['expected'], Locale::toAppStoreLocale($case['input']));
        }
        $this->assertCount($vector['distinctSlots'], array_unique(Locale::APP_STORE_LOCALES));
    }

    public function test_storage_key(): void
    {
        foreach ($this->vector('storage-key')['cases'] as $case) {
            $this->assertSame($case['expected'], Miss::lookupKeyFor($case['input']['key'], $case['input']['context'] ?? null), $case['name']);
        }
    }

    public function test_namespace_resolution(): void
    {
        foreach ($this->vector('namespace')['cases'] as $case) {
            if ($case['fn'] !== 'resolveNamespace') {
                continue; // originLanguage (user generated content) is not exposed by this package
            }
            $options = $case['input']['options'] ?? [];
            $this->assertSame(
                $case['expected'],
                KeylessTranslator::resolveNamespace($options['namespace'] ?? null, $case['input']['config']['defaultNamespace'] ?? null),
                $case['name']
            );
        }
    }

    public function test_retry_decision(): void
    {
        foreach ($this->vector('retry-decision')['cases'] as $case) {
            $decision = ApiClient::decide($case['input']['status'], $case['input']['statusText']);
            $this->assertSame($case['expected']['action'], $decision['action'], json_encode($case['input']));
            if (isset($case['expected']['error'])) {
                $this->assertSame($case['expected']['error'], $decision['error'], json_encode($case['input']));
            }
        }
    }

    public function test_backoff_schedule(): void
    {
        $vector = $this->vector('backoff');
        $client = new ApiClient(new Factory, 'k', 'https://api.test', $vector['timeoutMs'] / 1000, $vector['delaysMs']);
        $this->assertSame($vector['maxAttempts'], $client->maxAttempts());
        $this->assertSame($vector['timeoutMs'] / 1000, config('i18n-keyless.timeout'));
        $this->assertSame($vector['delaysMs'], config('i18n-keyless.retry'));
        foreach ($vector['cases'] as $case) {
            $this->assertSame($case['expected']['waitMs'], $client->delayAfter($case['input']['failedAttempt']), $case['name']);
        }
    }

    public function test_backoff_scenarios(): void
    {
        $vector = $this->vector('backoff');
        foreach ($vector['scenarios'] as $scenario) {
            Sleep::fake();
            $attempts = 0;
            $responses = $scenario['responses'];
            $http = new Factory;
            $http->fake(['https://api.test/*' => function () use (&$attempts, &$responses, $vector) {
                $attempts++;
                $answer = array_shift($responses);
                if (isset($answer['networkError'])) {
                    throw new ConnectionException($answer['networkError']);
                }
                if (! empty($answer['timeout'])) {
                    throw new ConnectionException('cURL error 28: Operation timed out after '.$vector['timeoutMs'].' milliseconds');
                }
                if (! empty($answer['invalidJson'])) {
                    return Http::response('{not json', 200);
                }

                return Http::response(isset($answer['body']) ? json_encode($answer['body']) : '', $answer['status']);
            }]);
            $client = new ApiClient($http, 'k', 'https://api.test', 10, $vector['delaysMs']);

            $result = $client->fetchDictionary('en', 'default', $scenario['name'] === '304 ends the call at once' ? 'W/"x"' : null);

            $this->assertSame($scenario['expected']['attempts'], $attempts, $scenario['name']);
            Sleep::assertSequence(array_map(fn (int $ms) => Sleep::for($ms)->milliseconds(), $scenario['expected']['sleepsMs']));
            $expected = $scenario['expected']['result'];
            $this->assertSame($expected['ok'], $result['ok'], $scenario['name']);
            if (isset($expected['notModified'])) {
                $this->assertSame($expected['notModified'], $result['notModified'], $scenario['name']);
            }
            if (isset($expected['error']) && $expected['error'] !== 'HTTP 403') {
                // Guzzle always fills a reason phrase, so an empty status text cannot be replayed on the wire:
                // that case is covered by test_retry_decision through ApiClient::decide().
                $this->assertSame($expected['error'], $result['error'], $scenario['name']);
            }
        }
    }

    public function test_dictionary_request(): void
    {
        foreach ($this->vector('dictionary-request')['cases'] as $case) {
            if (isset($case['expected']['handler'])) {
                continue; // custom handlers are not exposed by this package
            }
            $input = $case['input'];
            $http = new Factory;
            $http->fake(['*' => Http::response(['ok' => true, 'data' => ['translations' => []], 'error' => '', 'message' => ''])]);
            $client = new ApiClient($http, $input['config']['API_KEY'], $input['config']['API_URL'] ?? ApiClient::DEFAULT_URL);
            $client->fetchDictionary($input['targetLanguage'], $input['namespace'] ?? 'default', $input['knownEtag'] ?? null, $input['lastRefresh']);

            $expected = $case['expected'];
            $http->assertSent(function (Request $request) use ($expected) {
                $this->assertSame($expected['url'], $request->url());
                $this->assertSame($expected['method'], $request->method());
                foreach (['Content-Type', 'Authorization', 'If-None-Match'] as $header) {
                    if (isset($expected['headers'][$header])) {
                        $this->assertSame($expected['headers'][$header], $request->header($header)[0] ?? null);
                    }
                }
                $this->assertSame(ApiClient::VERSION, $request->header('Version')[0] ?? null);
                // A Laravel application is always a server: the sdk header says so, and no device id travels.
                $this->assertSame(ApiClient::SDK, $request->header('sdk')[0] ?? null);
                $this->assertFalse($request->hasHeader('unique_id'));
                $this->assertFalse($request->hasHeader('If-None-Match') && ! isset($expected['headers']['If-None-Match']));

                return true;
            });
        }
    }

    public function test_dictionary_response(): void
    {
        Log::spy();
        $warnings = [];
        foreach ($this->vector('dictionary-response')['cases'] as $case) {
            if (isset($case['expected']['warning'])) {
                $warnings[] = 'i18n-keyless: '.$case['expected']['warning'];
            }
            Sleep::fake();
            $attempts = 0;
            $responses = $case['responses'] ?? [$case['response']];
            $http = new Factory;
            $http->fake(['*' => function () use (&$attempts, &$responses) {
                $attempts++;
                $answer = array_shift($responses);

                return Http::response(isset($answer['body']) ? json_encode($answer['body']) : '', $answer['status'], $answer['headers'] ?? []);
            }]);
            $client = new ApiClient($http, $case['input']['config']['API_KEY'], ApiClient::DEFAULT_URL);
            $knownEtag = $case['input']['knownEtag'] ?? null;

            $result = $client->fetchDictionary($case['input']['targetLanguage'], 'default', $knownEtag);

            $expected = $case['expected'];
            if (isset($expected['attempts'])) {
                $this->assertSame($expected['attempts'], $attempts, $case['name']);
            }
            if ($expected['result'] === null) {
                $this->assertTrue(! $result['ok'] || $result['notModified'], $case['name']);
                $this->assertSame([], $result['translations'], $case['name']);
            } else {
                $this->assertTrue($result['ok'], $case['name']);
                $this->assertSame($expected['result']['data']['translations'], $result['translations'], $case['name']);
                $this->assertSame($expected['result']['etag'] ?? null, $result['etag'], $case['name']);
            }
            // The ETag a caller keeps afterwards: the new one, else the one it already had on a 304.
            $remembered = $result['notModified'] ? $knownEtag : $result['etag'];
            $this->assertSame($expected['etagRemembered'], $remembered, $case['name']);
            $this->assertSame(
                $expected['nextRequest']['url'],
                $client->dictionaryUrl($case['input']['targetLanguage'], 'default', $remembered, '1700000000'),
                $case['name']
            );
        }
        foreach ($warnings as $warning) {
            Log::shouldHaveReceived('warning')->with($warning)->once();
        }
    }

    public function test_translate_request(): void
    {
        foreach ($this->vector('translate-request')['cases'] as $case) {
            $options = $case['input']['options'] ?? [];
            if (isset($case['expected']['handler']) || isset($options['forceTemporary']) || isset($options['originLanguage'])) {
                continue; // not exposed by this package
            }
            $config = $case['input']['config'];
            $http = new Factory;
            $http->fake(['*' => Http::response(['ok' => true, 'data' => ['translation' => []], 'error' => '', 'message' => ''])]);
            $client = new ApiClient($http, $config['API_KEY'], $config['API_URL'] ?? ApiClient::DEFAULT_URL);
            $miss = new Miss(
                $case['input']['key'],
                $options['context'] ?? null,
                KeylessTranslator::resolveNamespace($options['namespace'] ?? null, $config['defaultNamespace'] ?? null),
            );

            $client->translate([$miss], $config['languages']['primary'], $config['languages']['supported']);

            $expected = $case['expected'];
            $http->assertSent(function (Request $request) use ($expected) {
                $this->assertSame($expected['url'], $request->url());
                $this->assertSame($expected['method'], $request->method());
                $this->assertSame($expected['headers']['Content-Type'], $request->header('Content-Type')[0] ?? null);
                $this->assertSame($expected['headers']['Authorization'], $request->header('Authorization')[0] ?? null);
                $this->assertSame(ApiClient::VERSION, $request->header('Version')[0] ?? null);
                $this->assertSame(ApiClient::SDK, $request->header('sdk')[0] ?? null);
                $this->assertFalse($request->hasHeader('unique_id'));
                $this->assertSame($expected['body'], $request->data());

                return true;
            });
        }
    }

    public function test_queue_scenarios(): void
    {
        foreach ($this->vector('queue')['scenarios'] as $scenario) {
            if (! is_array($scenario['calls'])) {
                continue; // "31 distinct keys": the in-flight peak is a promise-level property of the SDK queue
            }
            $skip = false;
            foreach ($scenario['calls'] as $call) {
                $options = $call['options'] ?? [];
                if (isset($options['originLanguage']) || isset($options['forceTemporary']) || isset($options['context'])) {
                    $skip = true; // not exposed, or deduplicated differently (this package keeps one POST per context)
                }
            }
            if ($skip) {
                continue;
            }
            $this->refreshApplication();
            Http::fake([
                'https://api.test/translate/*' => Http::response(['ok' => true, 'data' => ['translations' => $scenario['translations'] ?? []], 'error' => '', 'message' => '']),
                'https://api.test/translate' => Http::response(['ok' => true, 'data' => ['translation' => []], 'error' => '', 'message' => '']),
            ]);
            $this->app->setLocale('en');

            foreach ($scenario['calls'] as $call) {
                i18nk($call['key'], [], null, null, $call['options']['namespace'] ?? null);
            }
            $this->app->terminate();

            $posts = Http::recorded(fn (Request $r) => $r->method() === 'POST' && $r->url() === 'https://api.test/translate')->count();
            $this->assertSame($scenario['expected']['requests'], $posts, $scenario['name']);
        }
    }

    public function test_translation_lookup(): void
    {
        foreach ($this->vector('translation-lookup')['cases'] as $case) {
            $options = $case['input']['options'] ?? [];
            if (isset($options['originLanguage']) || isset($options['forceTemporary']) || isset($options['replace']) || isset($options['unpersistedNamespace'])) {
                continue; // not exposed by this package (placeholders are Laravel's `:name`)
            }
            $this->refreshApplication();
            $store = $case['input']['store'];
            $this->app['config']->set('i18n-keyless.primary', $store['primary']);
            $this->app['config']->set('i18n-keyless.namespace', $store['defaultNamespace'] ?? 'default');
            Http::fake(['https://api.test/translate/*' => Http::response(['ok' => true, 'data' => ['translations' => []], 'error' => '', 'message' => ''])]);
            $namespace = KeylessTranslator::resolveNamespace($options['namespace'] ?? null, $store['defaultNamespace'] ?? null);
            Cache::forever(
                'i18n-keyless:'.substr(sha1('test-key'), 0, 8).":dict:{$namespace}:{$store['currentLanguage']}",
                ['translations' => $store['translations'], 'etag' => null, 'fetched_at' => time(), 'failed' => false]
            );
            $this->app->setLocale($store['currentLanguage']);

            $text = i18nk($case['input']['key'], [], $options['context'] ?? null, null, $options['namespace'] ?? null);

            $this->assertSame($case['expected']['text'], $text, $case['name']);
            $queued = array_values(array_unique(array_map(
                fn (Miss $miss) => $miss->namespace,
                $this->app->make(KeylessTranslator::class)->pendingMisses()
            )));
            $this->assertSame(array_map(fn ($q) => $q['namespace'], $case['expected']['queued']), $queued, $case['name']);
        }
    }

    public function test_usage_reporting_matches_the_node_runtime(): void
    {
        $vector = $this->vector('usage-reporting');
        $node = null;
        foreach ($vector['cases'] as $case) {
            if (($case['input']['package'] ?? null) === 'node') {
                $node = $case['expected'];
            }
        }
        $this->assertNotNull($node);
        // `laravel` is registered on the API as a server label with the `node` rules.
        $this->assertSame('node', $node['runtime']);
        $this->assertSame('laravel', ApiClient::SDK);
        $this->assertTrue($node['recordsUsage']);
        $this->assertTrue($node['sendsUsage']);
        $this->assertFalse($node['sendsUniqueId']);
        $this->assertTrue(config('i18n-keyless.usage'));
        $this->assertSame(10, \I18nKeyless\Laravel\DictionaryStore::USAGE_FLUSH_SECONDS);

        // End to end: a served key is recorded, and the map leaves after the response.
        Http::fake([
            'https://api.test/translate/last-used-translations' => Http::response(['ok' => true, 'message' => '']),
            'https://api.test/translate/*' => Http::response(['ok' => true, 'data' => ['translations' => ['Bonjour' => 'Hello']], 'error' => '', 'message' => '']),
        ]);
        $this->app->setLocale('en');
        $this->assertSame('Hello', __('Bonjour'));
        $this->app->terminate();
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.test/translate/last-used-translations'
            && ! $r->hasHeader('unique_id')
            && $r->hasHeader('sdk', 'laravel')
            && $r->data()['translationsUsageByNamespace'] === ['default' => ['Bonjour' => gmdate('Y-m-d')]]);
    }

    public function test_usage_request(): void
    {
        foreach ($this->vector('usage-request')['cases'] as $case) {
            $config = $case['input']['config'];
            if (isset($case['expected']['handler'])) {
                continue; // custom handlers are not exposed by this package
            }
            $http = new Factory;
            $http->fake(['*' => Http::response(['ok' => true, 'message' => ''])]);
            $client = new ApiClient($http, $config['API_KEY'], $config['API_URL'] ?? ApiClient::DEFAULT_URL);

            $result = $client->sendUsage($config['languages']['primary'], $case['input']['usage']);

            $expected = $case['expected'];
            if (($expected['http'] ?? true) === false) {
                $this->assertFalse($result['sent'], $case['name']);
                $http->assertNothingSent();
                continue;
            }
            $this->assertTrue($result['ok'], $case['name']);
            $http->assertSent(function (Request $request) use ($expected) {
                $this->assertSame($expected['url'], $request->url());
                $this->assertSame($expected['method'], $request->method());
                $this->assertSame($expected['headers']['Content-Type'], $request->header('Content-Type')[0] ?? null);
                $this->assertSame($expected['headers']['Authorization'], $request->header('Authorization')[0] ?? null);
                $this->assertSame(ApiClient::VERSION, $request->header('Version')[0] ?? null);
                $this->assertSame(ApiClient::SDK, $request->header('sdk')[0] ?? null);
                $this->assertFalse($request->hasHeader('unique_id'));
                $this->assertSame($expected['body'], $request->data());

                return true;
            });
        }
    }

    public function test_a_server_sends_no_device_id(): void
    {
        $vector = $this->vector('unique-id');
        $this->assertStringContainsString('A server runtime sends no id', $vector['description']);
        $http = new Factory;
        $http->fake(['*' => Http::response(['ok' => true, 'data' => ['translations' => []], 'error' => '', 'message' => ''])]);
        (new ApiClient($http, 'k', 'https://api.test'))->fetchDictionary('en', 'default', null);
        $http->assertSent(fn (Request $r) => ! $r->hasHeader('unique_id') && $r->hasHeader('sdk', 'laravel'));
    }
}
