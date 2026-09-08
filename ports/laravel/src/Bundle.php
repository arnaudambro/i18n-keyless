<?php

namespace I18nKeyless\Laravel;

use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The precompiled bundle (docs/PROTOCOL.md, sections 4.5 and 7.4): a directory
 * holding `manifest.json` and one `<namespace>/<lang>.json` per dictionary, as
 * the MCP `export_bundle` tool or `GET /translate/bundle` yields it.
 *
 * A (namespace, lang) pair the manifest covers is read from the file instead
 * of fetched, with the manifest's cursor. The two static rules are pure and
 * replayed by conformance/vectors/bundle-seed.json.
 *
 * @phpstan-type Manifest array{primaryLanguage?: string, languages?: list<string>, exportedAt?: string, namespaces?: array<string, array{lastRefresh?: string, languages?: list<string>}>}
 * @phpstan-type Seed array{translations: array<string, string>, lastRefresh: ?string}
 * @phpstan-type Stored array{translations: array<string, string>, lastRefresh: mixed, lang: string}
 */
final class Bundle
{
    /** @param  Manifest  $manifest */
    public function __construct(
        private readonly string $path,
        private readonly array $manifest,
    ) {
    }

    /**
     * Reads `manifest.json` from the directory. Null when no path is configured;
     * null with one warning when the path holds no readable manifest.
     */
    public static function fromPath(?string $path): ?self
    {
        $path = rtrim((string) $path, '/\\');
        if ($path === '') {
            return null;
        }
        $manifest = self::readJson($path.DIRECTORY_SEPARATOR.'manifest.json');
        if ($manifest === null || ! isset($manifest['namespaces']) || ! is_array($manifest['namespaces'])) {
            self::warn("bundle_path \"{$path}\" holds no readable manifest.json: the bundle is ignored");

            return null;
        }

        return new self($path, $manifest);
    }

    public function path(): string
    {
        return $this->path;
    }

    /** @return Manifest */
    public function manifest(): array
    {
        return $this->manifest;
    }

    /** True when the manifest lists `$lang` under `$namespace`. */
    public function covers(string $namespace, string $lang): bool
    {
        return self::manifestCovers($this->manifest, $namespace, $lang);
    }

    /**
     * `bundleCovers(manifest, namespace, lang)` of the SDKs.
     *
     * @param  Manifest|null  $manifest
     */
    public static function manifestCovers(?array $manifest, string $namespace, string $lang): bool
    {
        $languages = $manifest['namespaces'][$namespace]['languages'] ?? null;

        return is_array($languages) && in_array($lang, $languages, true);
    }

    /** The namespaces the manifest lists, in manifest order. @return list<string> */
    public function namespaces(): array
    {
        return array_map('strval', array_keys($this->manifest['namespaces'] ?? []));
    }

    /** The cursor of one namespace (epoch ms as a string), or null. */
    public function lastRefresh(string $namespace): ?string
    {
        $cursor = $this->manifest['namespaces'][$namespace]['lastRefresh'] ?? null;

        return is_scalar($cursor) ? (string) $cursor : null;
    }

    /**
     * One covered dictionary with its cursor, or null when the pair is not
     * covered or the file is unreadable (logged: the caller falls back to the
     * fetch, like a pair the manifest does not list).
     *
     * @return Seed|null
     */
    public function seed(string $namespace, string $lang): ?array
    {
        if (! $this->covers($namespace, $lang)) {
            return null;
        }
        $file = $this->path.DIRECTORY_SEPARATOR.$namespace.DIRECTORY_SEPARATOR.$lang.'.json';
        $translations = self::readJson($file);
        if ($translations === null) {
            self::warn("bundle file \"{$file}\" is missing or unreadable: {$namespace}/{$lang} is fetched instead");

            return null;
        }

        return [
            'translations' => array_filter($translations, 'is_string'),
            'lastRefresh' => $this->lastRefresh($namespace),
        ];
    }

    /**
     * `mergeBundleWithStorage(bundle, stored, lang)` of the SDKs: the bundle is
     * the base. What storage holds is merged on top (its keys win) and its
     * cursor kept ONLY when its cursor is a strictly larger number than the
     * bundle's AND it is in `$lang`. A stored cursor that is empty, null or not
     * a number is never newer.
     *
     * @param  Seed  $bundle
     * @param  Stored|null  $stored
     * @return Seed
     */
    public static function mergeWithStorage(array $bundle, ?array $stored, string $lang): array
    {
        if ($stored === null || ($stored['lang'] ?? null) !== $lang) {
            return $bundle;
        }
        $storedRaw = $stored['lastRefresh'] ?? null;
        if ($storedRaw === null || $storedRaw === '' || ! is_numeric($storedRaw)) {
            return $bundle;
        }
        $bundleRaw = $bundle['lastRefresh'] ?? null;
        // `Number(x)` of the SDKs: null and "" are 0, anything else non-numeric is NaN,
        // and nothing is larger than NaN.
        if ($bundleRaw !== null && $bundleRaw !== '' && ! is_numeric($bundleRaw)) {
            return $bundle;
        }
        $bundleCursor = ($bundleRaw === null || $bundleRaw === '') ? 0.0 : (float) $bundleRaw;
        if (! ((float) $storedRaw > $bundleCursor)) {
            return $bundle;
        }

        return [
            // array_replace, not array_merge: a source text that is a number ("8") must keep its key.
            'translations' => array_replace($bundle['translations'], $stored['translations'] ?? []),
            'lastRefresh' => $stored['lastRefresh'],
        ];
    }

    /** @return array<string, mixed>|null */
    private static function readJson(string $file): ?array
    {
        try {
            if (! is_file($file) || ! is_readable($file)) {
                return null;
            }
            $json = json_decode((string) file_get_contents($file), true);

            return is_array($json) ? $json : null;
        } catch (Throwable) {
            return null;
        }
    }

    private static function warn(string $message): void
    {
        try {
            Log::warning("i18n-keyless: {$message}");
        } catch (Throwable) {
            // Logging must never take a translation down.
        }
    }
}
