<?php

namespace I18nKeyless\Laravel;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Translation\Translator;
use I18nKeyless\Laravel\Jobs\TranslateMissingKeys;

/**
 * The bridge between Laravel's translator and the i18n-keyless API.
 *
 * Nothing happens until the first `__()` call that misses in a non-primary
 * locale. That miss loads the locale's dictionary (from the cache, or from the
 * API once) and injects it into Laravel's translator with `addLines`, for the
 * JSON group `*`. Laravel's own loader stays in place: `lang/*.json`, PHP array
 * files and vendor files keep working, and a line from `lang/{locale}.json`
 * wins over the API's.
 *
 * A miss that is not in the dictionary either is recorded and the source text
 * is returned. The misses are sent to POST /translate after the response, in
 * `terminating`, or as a queued job.
 *
 * With usage reporting on (the default, like the node SDK), the dictionary is
 * NOT injected with `addLines`: every `__()` call in a non-primary locale is
 * served by the missing-key handler, so the date each key was last served is
 * recorded and POSTed to /translate/last-used-translations after the response,
 * at most once every 10 s across processes.
 */
final class KeylessTranslator
{
    public const DEFAULT_NAMESPACE = 'default';

    /** @var array<string, array<string, string>> "locale|namespace" => lines injected in this process */
    private array $loaded = [];

    /** @var array<string, Miss> keyed by Miss::id() */
    private array $misses = [];

    /** @var array<string, array{0: string, 1: ?string, 2: string}> lookup key => [key, context, namespace], set by i18nk() */
    private array $pending = [];

    /** @var array<string, array{0: string, 1: string, 2: string}> "lang|namespace" => [locale, lang, namespace] to revalidate after the response */
    private array $revalidate = [];

    /** @var array<string, array<string, string>> namespace => lookup key => YYYY-MM-DD, recorded during this request */
    private array $usage = [];

    /** One warning per process when no language is configured. */
    private bool $warnedNoLanguages = false;

    /**
     * @param  list<string>  $languages  every language the app serves (i18n-keyless codes)
     */
    public function __construct(
        private readonly Translator $translator,
        private readonly DictionaryStore $store,
        private readonly ApiClient $api,
        private readonly string $primary,
        private readonly array $languages = [],
        private readonly string $defaultNamespace = self::DEFAULT_NAMESPACE,
        private readonly ?string $queue = null,
        private readonly ?Application $app = null,
        private readonly bool $usageEnabled = true,
    ) {
    }

    public function usageEnabled(): bool
    {
        return $this->usageEnabled;
    }

    public function primary(): string
    {
        return $this->primary;
    }

    /** @return list<string> */
    public function languages(): array
    {
        return $this->languages;
    }

    public function defaultNamespace(): string
    {
        return $this->defaultNamespace;
    }

    /**
     * `resolveNamespace` of the SDKs: the per-call namespace, else the
     * configured default, else the literal `default`. Empty strings fall through.
     */
    public static function resolveNamespace(?string $perCall, ?string $configDefault): string
    {
        if ($perCall !== null && $perCall !== '') {
            return $perCall;
        }
        if ($configDefault !== null && $configDefault !== '') {
            return $configDefault;
        }

        return self::DEFAULT_NAMESPACE;
    }

    /**
     * The `i18nk()` helper: a translation with an optional `context`, resolved
     * through Laravel's translator so `:name` placeholders are Laravel's job.
     *
     * @param  array<string, mixed>  $replace
     */
    public function get(string $text, array $replace = [], ?string $context = null, ?string $locale = null, ?string $namespace = null): string
    {
        $locale = $locale ?: $this->translator->getLocale();
        $namespace = self::resolveNamespace($namespace, $this->defaultNamespace);
        $lookup = Miss::lookupKeyFor($text, $context);
        $lang = Locale::toLang($locale);
        if ($lang !== null && $lang !== $this->primary && $namespace !== $this->defaultNamespace) {
            // A non-default namespace is not loaded by the miss handler: load it now
            // so the lookup below can hit.
            $this->ensureLoaded($locale, $lang, $namespace);
        }
        $this->pending[$lookup] = [$text, $context, $namespace];
        try {
            return $this->translator->get($lookup, $replace, $locale);
        } finally {
            unset($this->pending[$lookup]);
        }
    }

    /**
     * The `Lang::handleMissingKeysUsing` callback. Returns the translation when
     * the dictionary has it, the source text otherwise (never null for a
     * context lookup, so "key__context" never leaks to the page).
     *
     * @param  array<string, mixed>  $replace
     */
    public function handleMissingKey(string $key, array $replace, string $locale, bool $fallback): ?string
    {
        [$source, $context, $namespace] = $this->pending[$key] ?? [$key, null, $this->defaultNamespace];
        $lang = Locale::toLang($locale);
        if ($lang === null) {
            return $source;
        }
        // Usage is recorded in the primary locale too, so the API does not prune
        // keys that only ever render in their source language (node SDK rule).
        $this->recordUsage($namespace, $key);
        if ($lang === $this->primary) {
            return $source;
        }
        $lines = $this->ensureLoaded($locale, $lang, $namespace);
        // An empty stored translation counts as missing, like in the SDKs.
        if (isset($lines[$key]) && $lines[$key] !== '') {
            return $lines[$key];
        }
        $this->recordMiss($source, $context, $namespace, $lang);

        return $source;
    }

    /**
     * Loads the (locale, namespace) dictionary once per process and injects it
     * into Laravel's translator.
     *
     * @return array<string, string>
     */
    public function ensureLoaded(string $locale, string $lang, string $namespace): array
    {
        $id = "{$locale}|{$namespace}";
        if (isset($this->loaded[$id])) {
            return $this->loaded[$id];
        }
        $entry = $this->store->get($lang, $namespace);
        if ($entry === null) {
            // First time ever for this language: the one blocking fetch.
            $result = $this->api->fetchDictionary($lang, $namespace, null);
            $entry = $result['ok']
                ? $this->store->put($lang, $namespace, $result['translations'], $result['etag'])
                : $this->store->put($lang, $namespace, [], null, failed: true);
        } elseif ($this->store->isStale($entry)) {
            // Serve what we have now, ask the API after the response.
            $this->revalidate["{$lang}|{$namespace}"] = [$locale, $lang, $namespace];
        }
        if (! $this->usageEnabled) {
            $this->inject($locale, $entry['translations']);
        }

        return $this->loaded[$id] = $entry['translations'];
    }

    /**
     * `Lang::addLines` for the JSON group. Laravel's file lines are loaded first
     * and win. Keys containing a dot are left to the miss handler: `addLines`
     * splits on dots and would nest them.
     *
     * @param  array<string, string>  $lines
     */
    private function inject(string $locale, array $lines): void
    {
        if ($lines === []) {
            return;
        }
        $this->translator->load('*', '*', $locale);
        $fileLines = $this->translator->getLoader()->load($locale, '*', '*');
        $toAdd = [];
        foreach ($lines as $key => $value) {
            if (! is_string($value) || $value === '' || isset($fileLines[$key]) || str_contains($key, '.')) {
                continue;
            }
            $toAdd['*.'.$key] = $value;
        }
        if ($toAdd !== []) {
            $this->translator->addLines($toAdd, $locale);
        }
    }

    private function recordUsage(string $namespace, string $lookupKey): void
    {
        if (! $this->usageEnabled || $lookupKey === '') {
            return;
        }
        $this->usage[$namespace][$lookupKey] = gmdate('Y-m-d');
    }

    /** @return array<string, array<string, string>> */
    public function pendingUsage(): array
    {
        return $this->usage;
    }

    private function recordMiss(string $key, ?string $context, string $namespace, string $lang): void
    {
        if ($key === '') {
            return;
        }
        $miss = new Miss($key, $context, $namespace);
        $miss = $this->misses[$miss->id()] ??= $miss;
        $miss->addLang($lang);
    }

    /** @return list<Miss> */
    public function pendingMisses(): array
    {
        return array_values($this->misses);
    }

    /**
     * Runs after the response is sent (`terminating`): POSTs the misses, then
     * revalidates the stale dictionaries served during the request.
     */
    public function flush(): void
    {
        $misses = array_values($this->misses);
        $this->misses = [];
        $revalidate = array_values($this->revalidate);
        $this->revalidate = [];

        if ($misses !== [] && ! $this->canTranslate()) {
            $misses = [];
        }
        $claimed = array_values(array_filter($misses, fn (Miss $miss) => $this->store->claimMiss($miss)));
        if ($claimed !== []) {
            if ($this->queue !== null && $this->queue !== '' && $this->app !== null) {
                $this->app->make(\Illuminate\Contracts\Bus\Dispatcher::class)->dispatch(
                    (new TranslateMissingKeys(array_map(fn (Miss $miss) => $miss->toArray(), $claimed)))->onQueue($this->queue)
                );
            } else {
                $this->translateNow($claimed);
            }
        }

        foreach ($revalidate as [$locale, $lang, $namespace]) {
            $this->revalidateNow($locale, $lang, $namespace);
        }

        $this->flushUsage();
    }

    /**
     * Merges this request's usage dates into the stored map, then POSTs the
     * whole map when it holds unsent changes and no POST left in the last 10 s.
     * Fire and forget: a failure keeps the changes for a later request.
     */
    private function flushUsage(): void
    {
        $recorded = $this->usage;
        $this->usage = [];
        if (! $this->usageEnabled) {
            return;
        }
        try {
            if ($recorded !== []) {
                $this->store->mergeUsage($recorded);
            }
            if (! $this->store->isUsageDirty() || ! $this->store->claimUsageSlot()) {
                return;
            }
            $result = $this->api->sendUsage($this->primary, $this->store->usage());
            if ($result['ok']) {
                $this->store->clearUsageDirty();
            }
        } catch (\Throwable) {
            // Analytics must never affect the response.
        }
    }

    /**
     * POST /translate for each miss and merge the answers into the cache, so
     * the very next request has them. The dictionaries are then marked stale:
     * the next request revalidates them with the API after its response.
     *
     * @param  list<Miss>  $misses
     */
    public function translateNow(array $misses): void
    {
        if ($misses === [] || ! $this->canTranslate()) {
            return;
        }
        $results = $this->api->translate($misses, $this->primary, $this->languages);
        $touched = [];
        foreach ($misses as $miss) {
            $translation = $results[$miss->id()] ?? null;
            if ($translation === null) {
                $this->store->releaseMiss($miss);
                continue;
            }
            $lookup = $miss->lookupKey();
            foreach ($translation as $lang => $text) {
                if ($lang === $this->primary || ! Locale::isLang($lang) || $text === '') {
                    continue;
                }
                $touched["{$miss->namespace}|{$lang}"][$lookup] = $text;
            }
        }
        foreach ($touched as $id => $lines) {
            [$namespace, $lang] = explode('|', $id, 2);
            $this->store->merge($lang, $namespace, $lines);
            $this->refreshLoaded($lang, $namespace, $lines);
        }
    }

    /**
     * POST /translate overwrites the project's language list with the one it
     * receives, so a miss is never sent without a configured list: it would
     * shrink the project to the primary language and damage every other client
     * on the same API key. The source text is served instead.
     */
    private function canTranslate(): bool
    {
        if ($this->languages !== []) {
            return true;
        }
        if (! $this->warnedNoLanguages) {
            $this->warnedNoLanguages = true;
            try {
                \Illuminate\Support\Facades\Log::warning(
                    'i18n-keyless: I18N_KEYLESS_LANGUAGES is required for translation: set it to every language your app serves (for example "en,fr,es"). Missing strings are served as their source text until then.'
                );
            } catch (\Throwable) {
                // Logging must never take a translation down.
            }
        }

        return false;
    }

    private function revalidateNow(string $locale, string $lang, string $namespace): void
    {
        $entry = $this->store->get($lang, $namespace);
        $result = $this->api->fetchDictionary($lang, $namespace, $entry['etag'] ?? null);
        if (! $result['ok']) {
            // Remember the failure briefly, so the next requests do not all retry.
            $this->store->put($lang, $namespace, $entry['translations'] ?? [], $entry['etag'] ?? null, failed: true);

            return;
        }
        if ($result['notModified']) {
            $this->store->touch($lang, $namespace);

            return;
        }
        $this->store->put($lang, $namespace, $result['translations'], $result['etag']);
        $this->refreshLoaded($lang, $namespace, $result['translations']);
    }

    /**
     * Keeps this process's injected lines current (a long-lived process, like
     * Octane or a queue worker, keeps the translator between requests).
     *
     * @param  array<string, string>  $lines
     */
    private function refreshLoaded(string $lang, string $namespace, array $lines): void
    {
        foreach ($this->loaded as $id => $loaded) {
            [$locale, $loadedNamespace] = explode('|', $id, 2);
            if ($loadedNamespace !== $namespace || Locale::toLang($locale) !== $lang) {
                continue;
            }
            $this->loaded[$id] = array_merge($loaded, $lines);
            if (! $this->usageEnabled) {
                $this->inject($locale, $lines);
            }
        }
    }
}
