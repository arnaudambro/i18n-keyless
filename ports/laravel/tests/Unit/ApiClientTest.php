<?php

namespace I18nKeyless\Laravel\Tests\Unit;

use I18nKeyless\Laravel\ApiClient;
use I18nKeyless\Laravel\Miss;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use PHPUnit\Framework\TestCase;

final class ApiClientTest extends TestCase
{
    private function client(): ApiClient
    {
        return new ApiClient(new Factory, 'k', 'https://api.test');
    }

    public function test_dictionary_url_without_etag_sends_an_empty_last_refresh(): void
    {
        $this->assertSame('https://api.test/translate/en?last_refresh=', $this->client()->dictionaryUrl('en', 'default', null));
        $this->assertSame('https://api.test/translate/en?last_refresh=null', $this->client()->dictionaryUrl('en', 'default', null, null));
        $this->assertSame(
            'https://api.test/translate/en?last_refresh=&namespace=checkout',
            $this->client()->dictionaryUrl('en', 'checkout', null)
        );
    }

    public function test_dictionary_url_with_etag_is_stable(): void
    {
        $this->assertSame('https://api.test/translate/en', $this->client()->dictionaryUrl('en', 'default', 'W/"1"'));
        $this->assertSame('https://api.test/translate/en?namespace=checkout', $this->client()->dictionaryUrl('en', 'checkout', 'W/"1"'));
    }

    public function test_translate_body_matches_the_sdk_wire_format(): void
    {
        $miss = new Miss('8 heures', 'duration', 'default', ['en']);
        $this->assertSame(
            ['key' => '8 heures', 'context' => 'duration', 'languages' => ['fr', 'en'], 'primaryLanguage' => 'fr'],
            $this->client()->translateBody($miss, 'fr', ['fr', 'en'])
        );

        // The configured list plus the primary; the locale that missed is never added.
        $plain = new Miss('Bonjour', null, 'checkout', ['es']);
        $this->assertSame(
            ['key' => 'Bonjour', 'namespace' => 'checkout', 'languages' => ['en', 'fr'], 'primaryLanguage' => 'fr'],
            $this->client()->translateBody($plain, 'fr', ['en'])
        );
    }

    public function test_retry_policy(): void
    {
        $this->assertSame(['action' => 'parse-body', 'error' => ''], ApiClient::decide(200, 'OK'));
        $this->assertSame(['action' => 'not-modified', 'error' => ''], ApiClient::decide(304, 'Not Modified'));
        $this->assertSame(['action' => 'retry', 'error' => 'Too Many Requests'], ApiClient::decide(429, 'Too Many Requests'));
        $this->assertSame(['action' => 'retry', 'error' => 'HTTP 503'], ApiClient::decide(503, ''));
        $this->assertSame(['action' => 'fail', 'error' => 'Unauthorized'], ApiClient::decide(401, 'Unauthorized'));
        $this->assertSame(['action' => 'fail', 'error' => 'HTTP 404'], ApiClient::decide(404, null));
        $this->assertSame(['action' => 'fail', 'error' => 'Created'], ApiClient::decide(201, 'Created'));
        $this->assertSame('timeout', ApiClient::errorFor(new ConnectionException('cURL error 28: Operation timed out after 10000 milliseconds')));
        $this->assertSame('offline', ApiClient::errorFor(new ConnectionException('offline')));
        $this->assertSame(3, $this->client()->maxAttempts());
        $this->assertSame(500, $this->client()->delayAfter(1));
        $this->assertSame(1500, $this->client()->delayAfter(2));
        $this->assertNull($this->client()->delayAfter(3));
    }

    public function test_default_config_mirrors_the_core_policy(): void
    {
        $config = require __DIR__.'/../../config/i18n-keyless.php';
        $this->assertSame(10, $config['timeout']);
        $this->assertSame([500, 1500], $config['retry']);
        $this->assertSame(30, $config['concurrency']);
        $this->assertSame('https://api.i18n-keyless.com', $config['api_url']);
        $this->assertSame('default', $config['namespace']);
        $this->assertSame(3600, $config['cache']['ttl']);
        $this->assertTrue($config['usage']);
    }
}
