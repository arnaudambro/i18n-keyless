<?php

namespace I18nKeyless\Laravel;

use Illuminate\Contracts\Cache\Repository as Cache;

/**
 * The per-language dictionaries in Laravel's cache (any driver), plus the
 * cross-request guard that keeps one miss from being POSTed by every request.
 *
 * A dictionary entry is stored forever: `ttl` is not its lifetime but the time
 * it is served without asking the API. A stale entry is still served, and
 * revalidated with its ETag after the response (a 304 keeps it as is).
 *
 * @phpstan-type Entry array{translations: array<string, string>, etag: ?string, fetched_at: int, failed: bool}
 */
final class DictionaryStore
{
    /** Seconds a failed fetch is remembered before the API is asked again. */
    public const FAILURE_TTL = 60;

    /** Minimum seconds between two usage POSTs, across every process (the node SDK's debounce). */
    public const USAGE_FLUSH_SECONDS = 10;

    public function __construct(
        private readonly Cache $cache,
        private readonly string $prefix,
        private readonly int $ttl,
        private readonly string $apiKeyHash,
    ) {
    }

    /** @return Entry|null */
    public function get(string $lang, string $namespace): ?array
    {
        $entry = $this->cache->get($this->key($lang, $namespace));

        return is_array($entry) && isset($entry['translations']) && is_array($entry['translations']) ? $entry : null;
    }

    /**
     * @param  array<string, string>  $translations
     * @return Entry
     */
    public function put(string $lang, string $namespace, array $translations, ?string $etag, bool $failed = false): array
    {
        $entry = [
            'translations' => $translations,
            'etag' => $etag,
            'fetched_at' => time(),
            'failed' => $failed,
        ];
        $this->cache->forever($this->key($lang, $namespace), $entry);

        return $entry;
    }

    /** After a 304: same dictionary, same ETag, fresh again. */
    public function touch(string $lang, string $namespace): void
    {
        $entry = $this->get($lang, $namespace);
        if ($entry === null) {
            return;
        }
        $entry['fetched_at'] = time();
        $entry['failed'] = false;
        $this->cache->forever($this->key($lang, $namespace), $entry);
    }

    /**
     * Adds freshly translated lines to a stored dictionary (after POST /translate),
     * and marks it stale so the next request revalidates with the API.
     *
     * @param  array<string, string>  $lines
     */
    public function merge(string $lang, string $namespace, array $lines): void
    {
        $entry = $this->get($lang, $namespace) ?? [
            'translations' => [],
            'etag' => null,
            'fetched_at' => 0,
            'failed' => false,
        ];
        $entry['translations'] = array_merge($entry['translations'], $lines);
        $entry['fetched_at'] = 0;
        $this->cache->forever($this->key($lang, $namespace), $entry);
    }

    public function markStale(string $lang, string $namespace): void
    {
        $entry = $this->get($lang, $namespace);
        if ($entry === null) {
            return;
        }
        $entry['fetched_at'] = 0;
        $this->cache->forever($this->key($lang, $namespace), $entry);
    }

    /** @param  Entry  $entry */
    public function isStale(array $entry): bool
    {
        $maxAge = ($entry['failed'] ?? false) ? min(self::FAILURE_TTL, $this->ttl) : $this->ttl;

        return (time() - (int) ($entry['fetched_at'] ?? 0)) > $maxAge;
    }

    /**
     * Claims a miss for this process: true when nobody POSTed it during the last
     * `ttl` seconds. Atomic on stores that support `add` (redis, memcached,
     * database, file, array).
     */
    public function claimMiss(Miss $miss): bool
    {
        return $this->cache->add($this->missKey($miss), 1, $this->ttl);
    }

    /** After a failed POST: let a later request try again. */
    public function releaseMiss(Miss $miss): void
    {
        $this->cache->forget($this->missKey($miss));
    }

    /**
     * The cumulative usage map, `{ namespace: { "key__context": "YYYY-MM-DD" } }`,
     * never cleared (the node SDK keeps it for the life of the process; here it
     * lives in the cache for the life of the cache).
     *
     * @return array<string, array<string, string>>
     */
    public function usage(): array
    {
        $usage = $this->cache->get($this->usageKey());

        return is_array($usage) ? $usage : [];
    }

    /**
     * Merges freshly recorded dates into the stored map. True when a date
     * changed (a new key, or a key seen on a new day).
     *
     * @param  array<string, array<string, string>>  $recorded
     */
    public function mergeUsage(array $recorded): bool
    {
        $usage = $this->usage();
        $changed = false;
        foreach ($recorded as $namespace => $keys) {
            foreach ($keys as $key => $date) {
                if (($usage[$namespace][$key] ?? null) !== $date) {
                    $usage[$namespace][$key] = $date;
                    $changed = true;
                }
            }
        }
        if ($changed) {
            $this->cache->forever($this->usageKey(), $usage);
            $this->cache->forever($this->usageKey().':dirty', true);
        }

        return $changed;
    }

    /** True while the stored map holds changes the API has not received. */
    public function isUsageDirty(): bool
    {
        return (bool) $this->cache->get($this->usageKey().':dirty', false);
    }

    public function clearUsageDirty(): void
    {
        $this->cache->forget($this->usageKey().':dirty');
    }

    /** Claims the right to POST usage now: false when a POST left less than 10 s ago. */
    public function claimUsageSlot(): bool
    {
        return $this->cache->add($this->usageKey().':lock', 1, self::USAGE_FLUSH_SECONDS);
    }

    public function usageKey(): string
    {
        return "{$this->prefix}:{$this->apiKeyHash}:usage";
    }

    public function key(string $lang, string $namespace): string
    {
        return "{$this->prefix}:{$this->apiKeyHash}:dict:{$namespace}:{$lang}";
    }

    private function missKey(Miss $miss): string
    {
        return "{$this->prefix}:{$this->apiKeyHash}:miss:".sha1($miss->id());
    }
}
