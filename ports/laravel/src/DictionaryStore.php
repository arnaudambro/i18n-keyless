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
 * `last_refresh` is the API's cursor for the dictionary (epoch ms as a string,
 * PROTOCOL.md section 4.2), or the bundle's when the entry was seeded from
 * one. It is never sent on the wire (the ETag carries freshness here): it
 * decides the precedence between a bundle and the cache (`seed`).
 *
 * @phpstan-type Entry array{translations: array<string, string>, etag: ?string, fetched_at: int, failed: bool, last_refresh?: ?string}
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
    public function put(string $lang, string $namespace, array $translations, ?string $etag, bool $failed = false, ?string $lastRefresh = null): array
    {
        $entry = [
            'translations' => $translations,
            'etag' => $etag,
            'fetched_at' => time(),
            'failed' => $failed,
            'last_refresh' => $lastRefresh,
        ];
        $this->cache->forever($this->key($lang, $namespace), $entry);

        return $entry;
    }

    /**
     * Applies one bundle dictionary (PROTOCOL.md 7.4) to the stored entry with
     * the SDKs' precedence (`Bundle::mergeWithStorage`): the bundle is the
     * base and the stored slice is merged on top, its cursor kept, only when
     * the cache is strictly newer than the bundle. Otherwise the bundle's
     * lines win, its cursor is stored, and the entry is fresh: no fetch and no
     * revalidation until `ttl` seconds pass. Keys the cache has and the bundle
     * lacks (a merged POST answer) are kept either way. Idempotent: a second
     * call with the same bundle writes nothing.
     *
     * @param  array{translations: array<string, string>, lastRefresh: ?string}  $seed
     * @return Entry
     */
    public function seed(string $lang, string $namespace, array $seed): array
    {
        $stored = $this->get($lang, $namespace);
        $merged = Bundle::mergeWithStorage(
            $seed,
            $stored === null ? null : [
                'translations' => $stored['translations'],
                'lastRefresh' => $stored['last_refresh'] ?? null,
                'lang' => $lang,
            ],
            $lang,
        );
        $translations = array_replace($stored['translations'] ?? [], $merged['translations']);
        $storageWins = $stored !== null && $merged['lastRefresh'] !== $seed['lastRefresh'];
        if ($storageWins) {
            if ($translations === $stored['translations']) {
                return $stored;
            }
            $entry = $stored;
            $entry['translations'] = $translations;
        } else {
            if ($stored !== null && $translations === $stored['translations'] && ($stored['last_refresh'] ?? null) === $merged['lastRefresh']) {
                return $stored;
            }
            $entry = [
                'translations' => $translations,
                // The ETag named what the API answered before the export: it no longer matches this content.
                'etag' => null,
                'fetched_at' => time(),
                'failed' => false,
                'last_refresh' => $merged['lastRefresh'],
            ];
        }
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
