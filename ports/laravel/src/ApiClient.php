<?php

namespace I18nKeyless\Laravel;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;
use Throwable;

/**
 * The two routes of the i18n-keyless wire format this package uses, with the
 * network policy of the SDKs (conformance/vectors/backoff.json and
 * retry-decision.json): a per-attempt timeout, three attempts with fixed
 * backoff delays on a network error, a timeout, a 429, a 5xx or an unparsable
 * 200 body; no retry on any other status; nothing ever thrown.
 *
 * Usage analytics (POST /translate/last-used-translations) follow the node
 * SDK: the cumulative map is POSTed, at most once every 10 s.
 */
final class ApiClient
{
    /**
     * Sent as the `Version` header. The API reads its major to pick the wire
     * dialect: >= 3 means the v3 language codes ("zh-Hans", "cs").
     */
    public const VERSION = '3.6.0';

    /**
     * Sent as the `sdk` header. `laravel` is registered on the API as a server
     * label, counted like `node`: a server sends no `unique_id`, the API counts
     * it by its source connection, which the client cannot shape.
     */
    public const SDK = 'laravel';

    public const DEFAULT_URL = 'https://api.i18n-keyless.com';

    public const ACTION_PARSE_BODY = 'parse-body';

    public const ACTION_NOT_MODIFIED = 'not-modified';

    public const ACTION_FAIL = 'fail';

    public const ACTION_RETRY = 'retry';

    /**
     * @param  list<int>  $retryDelays  milliseconds between attempts (two entries: three attempts)
     */
    public function __construct(
        private readonly Http $http,
        private readonly string $apiKey,
        private readonly string $apiUrl,
        private readonly int $timeout = 10,
        private readonly array $retryDelays = [500, 1500],
        private readonly int $concurrency = 30,
    ) {
    }

    public function maxAttempts(): int
    {
        return count($this->retryDelays) + 1;
    }

    /** The delay after a failed attempt (1-based), or null when there is no next attempt. */
    public function delayAfter(int $failedAttempt): ?int
    {
        return array_values($this->retryDelays)[$failedAttempt - 1] ?? null;
    }

    /**
     * GET /translate/{lang}: the whole dictionary of one language, or a 304
     * when the ETag still matches.
     *
     * @return array{ok: bool, notModified: bool, translations: array<string, string>, etag: ?string, error: ?string}
     */
    public function fetchDictionary(string $lang, string $namespace, ?string $etag, ?string $lastRefresh = ''): array
    {
        $result = ['ok' => false, 'notModified' => false, 'translations' => [], 'etag' => null, 'error' => null];
        $url = $this->dictionaryUrl($lang, $namespace, $etag, $lastRefresh);
        $call = $this->call(fn () => $this->request($etag)->get($url));
        if ($call['action'] === self::ACTION_NOT_MODIFIED) {
            $result['ok'] = true;
            $result['notModified'] = true;

            return $result;
        }
        if ($call['action'] !== self::ACTION_PARSE_BODY) {
            $result['error'] = $call['error'];
            $this->warn("fetch all translations error: {$call['error']}");

            return $result;
        }

        return $this->dictionaryFrom($call['json'], $call['response'], $result);
    }

    /**
     * POST /translate/last-used-translations: the cumulative usage map. An
     * empty map is never sent. Same network policy as every other call.
     *
     * @param  array<string, array<string, string>>  $usageByNamespace
     * @return array{ok: bool, sent: bool, error: ?string}
     */
    public function sendUsage(string $primary, array $usageByNamespace): array
    {
        if ($usageByNamespace === [] || $this->apiKey === '') {
            return ['ok' => false, 'sent' => false, 'error' => null];
        }
        $body = ['primaryLanguage' => $primary, 'translationsUsageByNamespace' => $usageByNamespace];
        $call = $this->call(fn () => $this->request()->post($this->apiUrl.'/translate/last-used-translations', $body));
        if ($call['action'] !== self::ACTION_PARSE_BODY) {
            $this->warn("send translations usage error: {$call['error']}");

            return ['ok' => false, 'sent' => true, 'error' => $call['error']];
        }
        $json = $call['json'];
        if (! empty($json['message'])) {
            $this->warn((string) $json['message']);
        }
        if (empty($json['ok'])) {
            $error = (string) ($json['error'] ?? 'not ok');
            $this->warn("send translations usage error: {$error}");

            return ['ok' => false, 'sent' => true, 'error' => $error];
        }

        return ['ok' => true, 'sent' => true, 'error' => null];
    }

    /**
     * One call with the shared network policy: up to `maxAttempts` attempts,
     * a backoff sleep after each failed one. Ends with `parse-body` (and the
     * decoded JSON), `not-modified`, or `fail` with the last error.
     *
     * @param  callable(): Response  $send
     * @return array{action: string, error: string, json: array<string, mixed>|null, response: ?Response}
     */
    private function call(callable $send): array
    {
        $error = '';
        for ($attempt = 1; $attempt <= $this->maxAttempts(); $attempt++) {
            try {
                $outcome = $this->outcome($send());
            } catch (Throwable $e) {
                $outcome = $this->outcome($e);
            }
            $error = $outcome['error'];
            if ($outcome['action'] === self::ACTION_NOT_MODIFIED) {
                return $outcome + ['json' => null];
            }
            if ($outcome['action'] === self::ACTION_PARSE_BODY) {
                $json = self::decodeJson($outcome['response']);
                if ($json !== null) {
                    return $outcome + ['json' => $json];
                }
                // An unparsable 200 body is a failed attempt, retried like a 5xx.
                $outcome['action'] = self::ACTION_RETRY;
                $error = 'invalid JSON';
            }
            if ($outcome['action'] === self::ACTION_FAIL) {
                break;
            }
            $this->sleepAfter($attempt);
        }

        return ['action' => self::ACTION_FAIL, 'error' => $error, 'json' => null, 'response' => null];
    }

    /**
     * POST /translate for every miss, at most `concurrency` at a time. Failed
     * attempts are retried together, one backoff sleep per round.
     *
     * @param  list<Miss>  $misses
     * @param  list<string>  $languages  the configured languages (the primary is added)
     * @return array<string, array<string, string>|null> translations by language, keyed by miss id; null when the call failed
     */
    public function translate(array $misses, string $primary, array $languages): array
    {
        $results = [];
        $pending = [];
        foreach ($misses as $miss) {
            $pending[$miss->id()] = $miss;
            $results[$miss->id()] = null;
        }
        $errors = [];
        for ($attempt = 1; $attempt <= $this->maxAttempts() && $pending !== []; $attempt++) {
            $retry = [];
            foreach (array_chunk($pending, max(1, $this->concurrency)) as $chunk) {
                $responses = $this->postChunk($chunk, $primary, $languages);
                foreach ($chunk as $miss) {
                    $outcome = $this->outcome($responses[$miss->id()] ?? new \RuntimeException('no response'));
                    $errors[$miss->id()] = $outcome['error'];
                    if ($outcome['action'] === self::ACTION_PARSE_BODY) {
                        $json = self::decodeJson($outcome['response']);
                        if ($json === null) {
                            $errors[$miss->id()] = 'invalid JSON';
                            $retry[$miss->id()] = $miss;
                            continue;
                        }
                        $results[$miss->id()] = $this->translationFrom($json, $miss);
                        continue;
                    }
                    if ($outcome['action'] === self::ACTION_RETRY) {
                        $retry[$miss->id()] = $miss;
                        continue;
                    }
                    // fail (or a 304 that makes no sense on a POST): give up on this miss now
                    $this->warn("translate error for \"{$miss->key}\": {$outcome['error']}");
                }
            }
            $pending = $retry;
            if ($pending !== []) {
                $this->sleepAfter($attempt);
            }
        }
        foreach ($pending as $miss) {
            $this->warn("translate error for \"{$miss->key}\": ".($errors[$miss->id()] ?? 'unknown error'));
        }

        return $results;
    }

    /**
     * @param  list<Miss>  $chunk
     * @param  list<string>  $languages
     * @return array<string, Response|Throwable>
     */
    private function postChunk(array $chunk, string $primary, array $languages): array
    {
        try {
            return $this->http->pool(function (Pool $pool) use ($chunk, $primary, $languages) {
                $requests = [];
                foreach ($chunk as $miss) {
                    $requests[] = $this->configure($pool->as($miss->id()))
                        ->post($this->apiUrl.'/translate', $this->translateBody($miss, $primary, $languages));
                }

                return $requests;
            });
        } catch (Throwable $e) {
            $responses = [];
            foreach ($chunk as $miss) {
                $responses[$miss->id()] = $e;
            }

            return $responses;
        }
    }

    /**
     * @param  list<string>  $languages
     * @return array<string, mixed>
     */
    public function translateBody(Miss $miss, string $primary, array $languages): array
    {
        $body = [
            'key' => $miss->key,
            'context' => $miss->context,
            // The default namespace is omitted on the wire, like the SDKs do.
            'namespace' => $miss->namespace === KeylessTranslator::DEFAULT_NAMESPACE ? null : $miss->namespace,
            // The configured list plus the primary, never the locale that missed: the
            // API stores this list as the project's languages (the react SDK sends its
            // required `supported` list the same way).
            'languages' => array_values(array_unique(array_merge($languages, [$primary]))),
            'primaryLanguage' => $primary,
        ];

        return array_filter($body, fn ($value) => $value !== null && $value !== '');
    }

    /**
     * What one attempt's answer does to the call. Statuses follow
     * conformance/vectors/retry-decision.json; `error` is the reason phrase
     * when non-empty, else `HTTP <code>`.
     *
     * @return array{action: string, error: string}
     */
    public static function decide(int $status, ?string $reason = null): array
    {
        $error = ($reason !== null && $reason !== '') ? $reason : "HTTP {$status}";
        if ($status === 200) {
            return ['action' => self::ACTION_PARSE_BODY, 'error' => ''];
        }
        if ($status === 304) {
            return ['action' => self::ACTION_NOT_MODIFIED, 'error' => ''];
        }
        if ($status === 429 || $status >= 500) {
            return ['action' => self::ACTION_RETRY, 'error' => $error];
        }

        return ['action' => self::ACTION_FAIL, 'error' => $error];
    }

    /** A network error or a timeout is transient; the SDKs spell a timeout `timeout`. */
    public static function errorFor(Throwable $e): string
    {
        $message = $e->getMessage();
        if (preg_match('/cURL error 28|timed out|timeout/i', $message)) {
            return 'timeout';
        }

        return $message !== '' ? $message : get_class($e);
    }

    /** @return array{action: string, error: string, response: ?Response} */
    private function outcome(Response|Throwable $answer): array
    {
        if ($answer instanceof Throwable) {
            return [
                'action' => $answer instanceof ConnectionException ? self::ACTION_RETRY : self::ACTION_FAIL,
                'error' => self::errorFor($answer),
                'response' => null,
            ];
        }

        return self::decide($answer->status(), $answer->reason()) + ['response' => $answer];
    }

    /** @return array<string, mixed>|null */
    private static function decodeJson(Response $response): ?array
    {
        $json = json_decode($response->body(), true);

        return is_array($json) ? $json : null;
    }

    /**
     * @param  array<string, mixed>  $json
     * @param  array{ok: bool, notModified: bool, translations: array<string, string>, etag: ?string, error: ?string}  $result
     * @return array{ok: bool, notModified: bool, translations: array<string, string>, etag: ?string, error: ?string}
     */
    private function dictionaryFrom(array $json, Response $response, array $result): array
    {
        if (empty($json['ok'])) {
            $result['error'] = (string) ($json['error'] ?? 'not ok');
            $this->warn("fetch all translations error: {$result['error']}");

            return $result;
        }
        if (! empty($json['message'])) {
            $this->warn((string) $json['message']);
        }
        $translations = $json['data']['translations'] ?? [];
        $result['ok'] = true;
        $result['translations'] = is_array($translations) ? array_filter($translations, 'is_string') : [];
        $result['etag'] = $response->header('ETag') ?: null;

        return $result;
    }

    /**
     * @param  array<string, mixed>  $json
     * @return array<string, string>|null
     */
    private function translationFrom(array $json, Miss $miss): ?array
    {
        if (empty($json['ok'])) {
            $this->warn("translate error for \"{$miss->key}\": ".(string) ($json['error'] ?? 'not ok'));

            return null;
        }
        if (! empty($json['message'])) {
            $this->warn((string) $json['message']);
        }
        $translation = $json['data']['translation'] ?? [];

        return is_array($translation) ? array_filter($translation, 'is_string') : [];
    }

    /**
     * The URL of a bulk fetch (conformance/vectors/dictionary-request.json).
     * With an ETag in hand, freshness travels in If-None-Match and the URL
     * stays stable, so shared HTTP caches can hold it. Without one, the delta
     * cursor travels as `last_refresh`: this package keeps no cursor and sends
     * it empty, which asks for the whole dictionary.
     */
    public function dictionaryUrl(string $lang, string $namespace, ?string $etag, ?string $lastRefresh = ''): string
    {
        // The default namespace is omitted from the query so a plain install
        // hits the exact same URL as the SDKs.
        $namespaceQuery = $namespace !== KeylessTranslator::DEFAULT_NAMESPACE
            ? '&namespace='.rawurlencode($namespace)
            : '';
        $query = $etag !== null
            ? ($namespaceQuery !== '' ? '?'.substr($namespaceQuery, 1) : '')
            : '?last_refresh='.($lastRefresh ?? 'null').$namespaceQuery;

        return "{$this->apiUrl}/translate/{$lang}{$query}";
    }

    private function request(?string $etag = null): PendingRequest
    {
        return $this->configure($this->http->withHeaders($etag !== null ? ['If-None-Match' => $etag] : []));
    }

    /** The headers and timeout every request carries. Retries are this class's job. */
    private function configure(PendingRequest $request): PendingRequest
    {
        return $request
            ->withHeaders([
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer '.$this->apiKey,
                'Version' => self::VERSION,
                'sdk' => self::SDK,
            ])
            ->acceptJson()
            ->timeout($this->timeout)
            ->connectTimeout($this->timeout);
    }

    private function sleepAfter(int $failedAttempt): void
    {
        $delay = $this->delayAfter($failedAttempt);
        if ($delay !== null && $delay > 0) {
            Sleep::for($delay)->milliseconds();
        }
    }

    private function warn(string $message): void
    {
        try {
            Log::warning("i18n-keyless: {$message}");
        } catch (Throwable) {
            // Logging must never take a translation down.
        }
    }
}
