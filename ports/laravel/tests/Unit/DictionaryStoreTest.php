<?php

namespace I18nKeyless\Laravel\Tests\Unit;

use I18nKeyless\Laravel\DictionaryStore;
use I18nKeyless\Laravel\Miss;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\Repository;
use PHPUnit\Framework\TestCase;

final class DictionaryStoreTest extends TestCase
{
    private Repository $cache;

    private DictionaryStore $store;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cache = new Repository(new ArrayStore);
        $this->store = new DictionaryStore($this->cache, 'i18n-keyless', 3600, 'abcd1234');
    }

    public function test_keys_carry_the_prefix_the_key_hash_the_namespace_and_the_language(): void
    {
        $this->assertSame('i18n-keyless:abcd1234:dict:checkout:pt-BR', $this->store->key('pt-BR', 'checkout'));
        $this->assertSame('i18n-keyless:abcd1234:usage', $this->store->usageKey());
    }

    public function test_a_malformed_entry_reads_as_missing(): void
    {
        $this->assertNull($this->store->get('en', 'default'));

        $this->cache->forever($this->store->key('en', 'default'), 'garbage');
        $this->assertNull($this->store->get('en', 'default'));

        $this->cache->forever($this->store->key('en', 'default'), ['translations' => 'not a map']);
        $this->assertNull($this->store->get('en', 'default'));

        $this->cache->forever($this->store->key('en', 'default'), ['etag' => 'W/"1"']);
        $this->assertNull($this->store->get('en', 'default'));
    }

    public function test_put_then_get_round_trips_and_is_fresh(): void
    {
        $entry = $this->store->put('en', 'default', ['Bonjour' => 'Hello'], 'W/"1"');

        $this->assertSame(['Bonjour' => 'Hello'], $entry['translations']);
        $this->assertSame('W/"1"', $entry['etag']);
        $this->assertFalse($entry['failed']);
        $this->assertSame($entry, $this->store->get('en', 'default'));
        $this->assertFalse($this->store->isStale($entry));
    }

    public function test_touch_and_mark_stale_ignore_a_missing_entry(): void
    {
        $this->store->touch('en', 'default');
        $this->store->markStale('en', 'default');

        $this->assertNull($this->store->get('en', 'default'));
    }

    public function test_mark_stale_keeps_the_lines_and_the_etag_but_forces_a_revalidation(): void
    {
        $this->store->put('en', 'default', ['Bonjour' => 'Hello'], 'W/"1"');

        $this->store->markStale('en', 'default');

        $entry = $this->store->get('en', 'default');
        $this->assertSame(['Bonjour' => 'Hello'], $entry['translations']);
        $this->assertSame('W/"1"', $entry['etag']);
        $this->assertSame(0, $entry['fetched_at']);
        $this->assertTrue($this->store->isStale($entry));
    }

    public function test_touch_makes_a_stale_or_failed_entry_fresh_again(): void
    {
        $this->store->put('en', 'default', ['Bonjour' => 'Hello'], 'W/"1"', failed: true);
        $this->store->markStale('en', 'default');

        $this->store->touch('en', 'default');

        $entry = $this->store->get('en', 'default');
        $this->assertFalse($entry['failed']);
        $this->assertGreaterThan(0, $entry['fetched_at']);
        $this->assertFalse($this->store->isStale($entry));
    }

    public function test_a_failed_entry_is_stale_after_the_failure_ttl_not_the_configured_ttl(): void
    {
        $fresh = ['translations' => [], 'etag' => null, 'fetched_at' => time() - DictionaryStore::FAILURE_TTL - 1, 'failed' => false];
        $this->assertFalse($this->store->isStale($fresh), 'a good entry lives for the configured ttl');
        $this->assertTrue($this->store->isStale(['failed' => true] + $fresh), 'a failure is retried after 60 s');
        $this->assertTrue($this->store->isStale(['translations' => []]), 'no fetched_at means stale');

        $short = new DictionaryStore($this->cache, 'i18n-keyless', 10, 'abcd1234');
        $this->assertTrue($short->isStale(['translations' => [], 'fetched_at' => time() - 11, 'failed' => true]), 'the shorter of the two wins');
        $this->assertFalse($short->isStale(['translations' => [], 'fetched_at' => time() - 5, 'failed' => true]));
    }

    public function test_merge_adds_lines_to_a_missing_or_existing_entry_and_marks_it_stale(): void
    {
        $this->store->merge('en', 'default', ['Bonjour' => 'Hello']);
        $entry = $this->store->get('en', 'default');
        $this->assertSame(['Bonjour' => 'Hello'], $entry['translations']);
        $this->assertNull($entry['etag']);
        $this->assertTrue($this->store->isStale($entry));

        $this->store->put('en', 'default', ['Bonjour' => 'Hello'], 'W/"1"');
        $this->store->merge('en', 'default', ['Au revoir' => 'Goodbye']);
        $entry = $this->store->get('en', 'default');
        $this->assertSame(['Bonjour' => 'Hello', 'Au revoir' => 'Goodbye'], $entry['translations']);
        $this->assertSame('W/"1"', $entry['etag']);
        $this->assertTrue($this->store->isStale($entry));
    }

    public function test_a_miss_is_claimed_once_until_released(): void
    {
        $miss = new Miss('Bonjour', null, 'default', ['en']);
        $sameKeyOtherLang = new Miss('Bonjour', null, 'default', ['es']);
        $otherContext = new Miss('Bonjour', 'greeting', 'default', ['en']);

        $this->assertTrue($this->store->claimMiss($miss));
        $this->assertFalse($this->store->claimMiss($miss));
        $this->assertFalse($this->store->claimMiss($sameKeyOtherLang), 'the claim is per (namespace, key, context)');
        $this->assertTrue($this->store->claimMiss($otherContext));

        $this->store->releaseMiss($miss);
        $this->assertTrue($this->store->claimMiss($miss));
    }

    public function test_usage_map_merges_by_date_and_tracks_dirtiness(): void
    {
        $this->assertSame([], $this->store->usage());
        $this->assertFalse($this->store->isUsageDirty());

        $this->cache->forever($this->store->usageKey(), 'garbage');
        $this->assertSame([], $this->store->usage(), 'a malformed map reads as empty');

        $this->assertTrue($this->store->mergeUsage(['default' => ['Bonjour' => '2026-01-01']]));
        $this->assertTrue($this->store->isUsageDirty());
        $this->store->clearUsageDirty();
        $this->assertFalse($this->store->isUsageDirty());

        $this->assertFalse($this->store->mergeUsage(['default' => ['Bonjour' => '2026-01-01']]), 'same date: nothing changed');
        $this->assertFalse($this->store->isUsageDirty());

        $this->assertTrue($this->store->mergeUsage(['default' => ['Bonjour' => '2026-01-02'], 'checkout' => ['Payer' => '2026-01-02']]));
        $this->assertSame(['default' => ['Bonjour' => '2026-01-02'], 'checkout' => ['Payer' => '2026-01-02']], $this->store->usage());
    }

    public function test_the_usage_slot_is_claimed_once_per_10_seconds(): void
    {
        $this->assertTrue($this->store->claimUsageSlot());
        $this->assertFalse($this->store->claimUsageSlot());

        $this->cache->forget($this->store->usageKey().':lock');
        $this->assertTrue($this->store->claimUsageSlot());
    }
}
