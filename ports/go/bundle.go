package i18nkeyless

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// The precompiled bundle (PROTOCOL.md sections 4.5 and 7.4): a directory exported at build
// time by the MCP `export_bundle` tool or from `GET /translate/bundle`, holding
// `manifest.json` plus one `<namespace>/<lang>.json` per dictionary. Pointed at it
// (Config.BundlePath), New reads every dictionary the manifest lists into the store and Init
// skips the boot fetch of a namespace the manifest covers. Nothing else changes: a miss still
// POSTs, and the refetch that follows a burst of misses still runs.
//
// BundleCovers and MergeBundleWithStorage are pure and replayed by
// conformance/vectors/bundle-seed.json.

// BundleManifest is the parsed `manifest.json`: the bundle without its dictionaries.
type BundleManifest struct {
	PrimaryLanguage string                     `json:"primaryLanguage"`
	Languages       []string                   `json:"languages"`
	ExportedAt      string                     `json:"exportedAt"`
	Namespaces      map[string]BundleNamespace `json:"namespaces"`
}

// BundleNamespace is one namespace of the manifest: its cursor and the languages that have
// a file.
type BundleNamespace struct {
	LastRefresh string   `json:"lastRefresh"`
	Languages   []string `json:"languages"`
}

// BundleSeed is the seed of one namespace: a dictionary and the cursor that goes with it.
type BundleSeed struct {
	Translations map[string]string
	LastRefresh  string
}

// StoredSeed is what storage holds for one namespace: its slice, its cursor and the
// language it is in.
type StoredSeed struct {
	Translations map[string]string
	LastRefresh  string
	Lang         string
}

// BundleCovers reports whether the manifest lists lang under namespace.
func BundleCovers(manifest *BundleManifest, namespace, lang string) bool {
	if manifest == nil {
		return false
	}
	entry, ok := manifest.Namespaces[namespace]
	if !ok {
		return false
	}
	for _, l := range entry.Languages {
		if l == lang {
			return true
		}
	}
	return false
}

// BundleNamespaces lists the namespaces of the manifest in the export order of PROTOCOL.md
// section 4.5: `default` first, the others alphabetically (a Go map keeps no document
// order). Two namespaces sharing one source text merge into one flat entry, so the order
// decides which text wins: the later one.
func BundleNamespaces(manifest *BundleManifest) []string {
	if manifest == nil {
		return nil
	}
	names := make([]string, 0, len(manifest.Namespaces))
	for name := range manifest.Namespaces {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		if names[i] == DefaultNamespace || names[j] == DefaultNamespace {
			return names[i] == DefaultNamespace
		}
		return names[i] < names[j]
	})
	return names
}

// bundleCoversNamespace reports whether the manifest covers namespace in at least one
// language (the node rule): Init then skips the boot fetch of that namespace, New already
// seeded every dictionary the manifest has for it.
func bundleCoversNamespace(manifest *BundleManifest, namespace string) bool {
	if manifest == nil {
		return false
	}
	for _, lang := range manifest.Namespaces[namespace].Languages {
		if BundleCovers(manifest, namespace, lang) {
			return true
		}
	}
	return false
}

// cursorNumber is JavaScript's `Number()` for a cursor: the value as a finite number, or
// false. An empty cursor is never a number.
func cursorNumber(value string) (float64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsInf(n, 0) || math.IsNaN(n) {
		return 0, false
	}
	return n, true
}

// MergeBundleWithStorage is the precedence between the bundle and what storage holds for
// the same namespace. The bundle is the base. Storage wins (its keys on top, its cursor
// kept) only when it is strictly newer, its cursor a larger number than the bundle's, AND it
// is in the language being seeded. Anything else answers the bundle unchanged: a slice in
// another language, an equal or older cursor, an empty or non-numeric cursor.
func MergeBundleWithStorage(bundle BundleSeed, stored *StoredSeed, lang string) BundleSeed {
	if stored == nil || stored.Lang != lang {
		return bundle
	}
	storedCursor, ok := cursorNumber(stored.LastRefresh)
	if !ok {
		return bundle
	}
	bundleCursor, ok := cursorNumber(bundle.LastRefresh)
	if !ok || !(storedCursor > bundleCursor) {
		return bundle
	}
	merged := make(map[string]string, len(bundle.Translations)+len(stored.Translations))
	for k, v := range bundle.Translations {
		merged[k] = v
	}
	for k, v := range stored.Translations {
		merged[k] = v
	}
	return BundleSeed{Translations: merged, LastRefresh: stored.LastRefresh}
}

// ReadBundleManifest parses `<dir>/manifest.json`. A missing or malformed file is an
// error: the path is configuration, and a wrong one must not pass silently.
func ReadBundleManifest(dir string) (*BundleManifest, error) {
	path := filepath.Join(dir, "manifest.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("i18n-keyless: no manifest.json in the bundle directory %s", dir)
		}
		return nil, fmt.Errorf("i18n-keyless: cannot read the bundle manifest %s: %w", path, err)
	}
	var manifest BundleManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, fmt.Errorf("i18n-keyless: cannot read the bundle manifest %s: %w", path, err)
	}
	if manifest.Namespaces == nil {
		return nil, fmt.Errorf("i18n-keyless: %s is not a bundle manifest (no `namespaces` object)", path)
	}
	return &manifest, nil
}

// readBundleFile parses `<dir>/<namespace>/<lang>.json`: one dictionary. A value that is not
// a string is dropped.
func readBundleFile(dir, namespace, lang string) (map[string]string, error) {
	path := filepath.Join(dir, namespace, lang+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var loose map[string]any
	if err := json.Unmarshal(raw, &loose); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	dictionary := make(map[string]string, len(loose))
	for key, value := range loose {
		if text, ok := value.(string); ok {
			dictionary[key] = text
		}
	}
	return dictionary, nil
}

// seedFromBundle reads every (namespace, lang) the manifest lists into the flat per-language
// maps. A file that is missing or malformed is logged and its pair treated as not covered
// (the boot fetch of its namespace is still skipped, like the node SDK: coverage is the
// manifest's). The precedence rule of PROTOCOL.md 7.4 is applied against what the store
// holds for the pair: this port persists nothing and knows no cursor for it, so at
// construction the bundle is always the base and wins.
func (c *Client) seedFromBundle(dir string, manifest *BundleManifest) {
	for _, namespace := range BundleNamespaces(manifest) {
		entry := manifest.Namespaces[namespace]
		for _, lang := range entry.Languages {
			if !IsLang(lang) || !BundleCovers(manifest, namespace, lang) {
				continue
			}
			dictionary, err := readBundleFile(dir, namespace, lang)
			if err != nil {
				c.logf("i18n-keyless: bundle file for %s/%s cannot be read: %v", namespace, lang, err)
				continue
			}
			seed := BundleSeed{Translations: dictionary, LastRefresh: entry.LastRefresh}
			c.mu.Lock()
			var stored *StoredSeed
			if held := c.translations[lang]; len(held) > 0 {
				stored = &StoredSeed{Translations: held, Lang: lang}
			}
			for storageKey, text := range MergeBundleWithStorage(seed, stored, lang).Translations {
				c.translations[lang][storageKey] = text
			}
			c.mu.Unlock()
		}
	}
}
