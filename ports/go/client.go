package i18nkeyless

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// Languages names the language the source texts are written in and the ones the project
// translates into.
type Languages struct {
	// Primary is the language your source texts are written in: one of the 48 codes. It is
	// set on the project by its first translation and is immutable afterwards.
	Primary string
	// Supported is every language the project serves, Primary included by convention. It is
	// sent on every translate request and the API stores it as the project's language list
	// (it replaces the previous one), so keep it complete.
	Supported []string
}

// Logger receives the port's warnings and errors, prefixed `i18n-keyless:`. The standard
// library's *log.Logger satisfies it; the default is log.Default().
type Logger interface {
	Printf(format string, v ...any)
}

// Config configures a Client. Three modes, in priority order (PROTOCOL.md section 2.2):
// custom handlers, a self-hosted APIURL, the official service.
type Config struct {
	// APIKey is your project's public key (https://i18n-keyless.com/#get-api-key), sent as
	// `Authorization: Bearer`. Required unless both HandleTranslate and
	// GetAllTranslationsForAllLanguages are set, or APIURL names a backend of your own.
	APIKey string
	// APIURL is the base URL of a self-hosted backend or proxy, without a trailing slash.
	// Empty means the official service.
	APIURL string
	// Languages is required: Primary, and Supported.
	Languages Languages
	// DefaultNamespace applies to every call that passes no WithNamespace. Empty means the
	// literal `default`.
	DefaultNamespace string
	// Debug logs every lookup and request.
	Debug bool
	// Logger receives warnings; nil means log.Default().
	Logger Logger
	// HTTPClient performs the requests; nil means http.DefaultClient. Timeouts are applied
	// per attempt by the port, so the client needs none of its own.
	HTTPClient *http.Client
	// DisableUsage switches usage analytics off (the "last used" dates the dashboard shows).
	DisableUsage bool

	// HandleTranslate replaces `POST /translate` (mode 1). It receives the source text only
	// (no context, no namespace, no languages: the handler owns that knowledge) and returns
	// the translation of that text by language code; the map is cached for every known
	// language it names.
	HandleTranslate func(ctx context.Context, key string) (map[string]string, error)
	// GetAllTranslationsForAllLanguages replaces `GET /translate/` (mode 1): every language's
	// dictionary at once, keyed by language code then storage key.
	GetAllTranslationsForAllLanguages func(ctx context.Context) (map[string]map[string]string, error)
	// SendTranslationsUsage replaces the usage POST (mode 1). Like in every SDK it receives
	// the default namespace's bucket only.
	SendTranslationsUsage func(ctx context.Context, defaultBucket map[string]string) error
	// OnInit is called once, with the primary language, before the boot fetch.
	OnInit func(primary string)
}

// Client holds the in-memory dictionaries of one project and translates against them. It
// is safe for concurrent use from any number of goroutines.
type Client struct {
	cfg    Config
	apiURL string
	tr     *transport
	logger Logger

	mu sync.Mutex
	// translations is one flat map per language, keyed by storage key; no namespace
	// dimension, like the bulk fetch that feeds it at Init. Two namespaces sharing one source
	// text share one entry.
	translations map[string]map[string]string
	// etags remembers the ETag of every dictionary fetched by this process, keyed by
	// EtagCacheKey, and replays it as If-None-Match. In memory only: after a restart the
	// first fetch is a plain 200.
	etags map[string]string
	// usage is the cumulative usage map: namespace, then storage key, then the UTC date of
	// its last use. Never cleared, like the node SDK's.
	usage      map[string]map[string]string
	usageTimer *time.Timer
	// usageDebounce is the window one usage POST covers; tests shorten it.
	usageDebounce time.Duration
	// now is injectable so tests pin the usage date.
	now func() time.Time

	// sem bounds the translate requests in flight at once.
	sem chan struct{}
	// inflight dedupes concurrent misses of one storage key: followers await the leader's
	// POST instead of firing their own.
	inflight map[string]*flight
	// inflightCount and namespacesToFetch drive the refetch that follows a burst of misses:
	// when the last POST settles, every namespace that missed is fetched again in full, so
	// the store also holds what other namespaces and other processes translated meanwhile.
	inflightCount     int
	namespacesToFetch map[string]struct{}
	bg                sync.WaitGroup
}

// flight is one in-flight `POST /translate`, shared by every caller waiting for the same
// storage key.
type flight struct {
	done   chan struct{}
	byLang map[string]string
	err    error
}

// New validates the configuration and returns a client with empty dictionaries. Nothing
// leaves the process: use Init to also load the dictionaries.
func New(cfg Config) (*Client, error) {
	if cfg.Languages.Primary == "" {
		return nil, errors.New("i18n-keyless: primary is required")
	}
	if !IsLang(cfg.Languages.Primary) {
		return nil, fmt.Errorf("i18n-keyless: unknown primary language %q", cfg.Languages.Primary)
	}
	for _, lang := range cfg.Languages.Supported {
		if !IsLang(lang) {
			return nil, fmt.Errorf("i18n-keyless: unknown supported language %q", lang)
		}
	}
	if cfg.APIKey == "" && cfg.APIURL == "" && (cfg.HandleTranslate == nil || cfg.GetAllTranslationsForAllLanguages == nil) {
		return nil, errors.New("i18n-keyless: you didn't provide an APIKey nor an APIURL nor a HandleTranslate + GetAllTranslationsForAllLanguages function. You need to provide one of them to make i18n-keyless work")
	}
	logger := cfg.Logger
	if logger == nil {
		logger = log.Default()
	}
	apiURL := cfg.APIURL
	if apiURL == "" {
		apiURL = DefaultAPIURL
	}
	c := &Client{
		cfg:               cfg,
		apiURL:            apiURL,
		tr:                newTransport(cfg.HTTPClient),
		logger:            logger,
		translations:      map[string]map[string]string{},
		etags:             map[string]string{},
		usage:             map[string]map[string]string{},
		usageDebounce:     usageFlushDebounce,
		now:               time.Now,
		sem:               make(chan struct{}, maxConcurrentTranslations),
		inflight:          map[string]*flight{},
		namespacesToFetch: map[string]struct{}{},
	}
	for _, lang := range AvailableLangs {
		c.translations[lang] = map[string]string{}
	}
	return c, nil
}

// Init is New followed by the boot fetch: every language's dictionary of the default
// namespace, in one `GET /translate/`. A failed fetch is logged, never returned: the
// client starts empty and translates on miss, so an app boots even when the API is down.
// The error is a configuration error only.
func Init(ctx context.Context, cfg Config) (*Client, error) {
	c, err := New(cfg)
	if err != nil {
		return nil, err
	}
	if cfg.OnInit != nil {
		cfg.OnInit(cfg.Languages.Primary)
	}
	// The boot fetch targets the configured namespace, otherwise a project using
	// DefaultNamespace would boot with the (empty) `default` one and every key would miss.
	c.refetch(ctx, ResolveNamespace("", cfg.DefaultNamespace))
	return c, nil
}

// maxConcurrentTranslations is the queue concurrency of every SDK: at most 30 translate
// requests in flight at once.
const maxConcurrentTranslations = 30

// usageFlushDebounce is the window one usage POST covers: a server rendering a page with
// hundreds of keys would otherwise POST the cumulative map once per key.
const usageFlushDebounce = 10 * time.Second

// T returns the translation of key in lang, or the key itself when there is none, and
// never fails: a miss is sent to the API and answered in this call (dedupe and the 30-slot
// semaphore apply); a failed request is logged and the key is returned with the replace
// option applied. Use Translate to see the error.
//
// The key is returned as is, with no request, when lang is the language it is written in
// (the primary language, or WithOriginLanguage). The text is not trimmed: what you pass is
// what is stored.
func (c *Client) T(ctx context.Context, key, lang string, opts ...Option) string {
	text, err := c.Translate(ctx, key, lang, opts...)
	if err != nil {
		c.logf("%v", err)
	}
	return text
}

// Translate is T with the error: a failed `POST /translate` (network, a non-ok answer, a
// custom HandleTranslate that fails) is returned, together with the key as the text to
// render. An empty key returns "" and sends nothing.
func (c *Client) Translate(ctx context.Context, key, lang string, opts ...Option) (string, error) {
	o := applyOptions(opts)
	if key == "" {
		return "", nil
	}
	if c.cfg.APIKey == "" && c.cfg.HandleTranslate == nil && c.cfg.APIURL == "" {
		return o.replaced(key), errors.New("i18n-keyless: config lacks APIKey and HandleTranslate. Cannot proceed.")
	}
	if !IsLang(lang) {
		// The store has no bucket for an unknown code, and the API translates into the
		// configured languages only: asking would POST on every call and never fill anything.
		c.debugf("unknown language %q for key %q: returning the key", lang, key)
		return o.replaced(key), nil
	}
	primary := c.cfg.Languages.Primary
	namespace := ResolveNamespace(o.namespace, c.cfg.DefaultNamespace)
	storageKey := StorageKeyFor(key, o.context)
	c.recordUsage(namespace, storageKey, o.unpersisted)

	// The language the key is already written in: the primary language, except for UGC.
	// When lang is that one the key renders as is, with no lookup and no request, except
	// that an explicit forceTemporary for that very language still travels, to register
	// the override (the node rule; the client SDKs send nothing in that case).
	source := ResolveOriginLanguage(o.originLanguage, primary)
	if source == "" {
		source = primary
	}
	forced := o.forceTemporary[lang]
	if lang == source && forced == "" {
		return o.replaced(key), nil
	}
	if text := c.lookup(lang, storageKey); text != "" && forced == "" {
		return o.replaced(text), nil
	}

	if c.cfg.HandleTranslate != nil {
		byLang, err := c.cfg.HandleTranslate(ctx, key)
		if err != nil {
			return o.replaced(key), fmt.Errorf("i18n-keyless: HandleTranslate failed for key %q: %w", key, err)
		}
		c.cache(storageKey, byLang)
		if text := c.lookup(lang, storageKey); text != "" {
			return o.replaced(text), nil
		}
		return o.replaced(key), nil
	}

	byLang, err := c.translateViaAPI(ctx, key, storageKey, namespace, &o)
	if err != nil {
		return o.replaced(key), fmt.Errorf("i18n-keyless: translate failed for key %q: %w", key, err)
	}
	if text := byLang[lang]; text != "" {
		return o.replaced(text), nil
	}
	c.debugf("no %s translation in the API answer for key %q: returning the key", lang, key)
	return o.replaced(key), nil
}

// SupportedLanguages returns the configured supported languages.
func (c *Client) SupportedLanguages() []string {
	return append([]string(nil), c.cfg.Languages.Supported...)
}

// PrimaryLanguage returns the configured primary language.
func (c *Client) PrimaryLanguage() string {
	return c.cfg.Languages.Primary
}

// Close stops the usage timer without sending and waits for the background refetches. A
// script that wants its usage reported calls FlushUsage first.
func (c *Client) Close() {
	c.mu.Lock()
	if c.usageTimer != nil {
		c.usageTimer.Stop()
		c.usageTimer = nil
	}
	c.mu.Unlock()
	c.bg.Wait()
}

func (c *Client) lookup(lang, storageKey string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.translations[lang][storageKey]
}

// cache merges one translation into the store for every known language the answer names.
// A number, an empty string or an unknown code is not a translation and never enters the
// store (a custom handler is free to return anything).
func (c *Client) cache(storageKey string, byLang map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for lang, text := range byLang {
		if text == "" || !IsLang(lang) {
			continue
		}
		c.translations[lang][storageKey] = text
	}
}

// translateRequest is the `POST /translate` body (PROTOCOL.md section 4.1). A field whose
// value is absent is not serialised.
type translateRequest struct {
	Key             string            `json:"key"`
	Context         string            `json:"context,omitempty"`
	Namespace       string            `json:"namespace,omitempty"`
	ForceTemporary  map[string]string `json:"forceTemporary,omitempty"`
	Languages       []string          `json:"languages"`
	PrimaryLanguage string            `json:"primaryLanguage"`
	OriginLanguage  string            `json:"originLanguage,omitempty"`
}

// translateResponse is the part of the answer this port reads: the row's `languages` map.
// The flat top-level keys are the v2 shape and cannot carry Indonesian (`id` is the numeric
// row id there), so they are never read.
type translateResponse struct {
	Data struct {
		Translation struct {
			Languages map[string]*string `json:"languages"`
		} `json:"translation"`
	} `json:"data"`
}

// translateViaAPI sends one miss and caches the answer, collapsing concurrent misses of the
// same storage key: a server handling N simultaneous requests would otherwise fire N
// identical POSTs before the first one fills the store. forceTemporary calls are never
// shared (they carry a caller-specific value). The origin language is part of the dedupe
// key because it changes what the API stores.
func (c *Client) translateViaAPI(ctx context.Context, key, storageKey, namespace string, o *callOptions) (map[string]string, error) {
	dedupeKey := namespace + ":" + storageKey + ":" + ResolveOriginLanguage(o.originLanguage, c.cfg.Languages.Primary)
	canDedupe := o.forceTemporary == nil

	c.mu.Lock()
	if canDedupe {
		if f, ok := c.inflight[dedupeKey]; ok {
			c.mu.Unlock()
			return c.await(ctx, f)
		}
	}
	f := &flight{done: make(chan struct{})}
	if canDedupe {
		c.inflight[dedupeKey] = f
	}
	c.inflightCount++
	c.namespacesToFetch[namespace] = struct{}{}
	c.mu.Unlock()

	// The leader runs off the caller's goroutine so a cancelled caller does not abandon the
	// followers; Close waits for it, and for the refetch it may spawn.
	c.bg.Add(1)
	go func() {
		defer c.bg.Done()
		f.byLang, f.err = c.postTranslate(ctx, key, storageKey, namespace, o)
		close(f.done)
		c.mu.Lock()
		if canDedupe {
			delete(c.inflight, dedupeKey)
		}
		c.inflightCount--
		var namespaces []string
		if c.inflightCount == 0 {
			for ns := range c.namespacesToFetch {
				namespaces = append(namespaces, ns)
			}
			c.namespacesToFetch = map[string]struct{}{}
		}
		c.mu.Unlock()
		// The burst is over: refetch what missed, in the background, off the caller's path.
		for _, ns := range namespaces {
			c.bg.Add(1)
			go func(ns string) {
				defer c.bg.Done()
				c.refetch(context.Background(), ns)
			}(ns)
		}
	}()
	return c.await(ctx, f)
}

func (c *Client) await(ctx context.Context, f *flight) (map[string]string, error) {
	select {
	case <-f.done:
		return f.byLang, f.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// postTranslate performs the `POST /translate`, bounded by the semaphore.
func (c *Client) postTranslate(ctx context.Context, key, storageKey, namespace string, o *callOptions) (map[string]string, error) {
	select {
	case c.sem <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-c.sem }()

	body := translateRequest{
		Key:     key,
		Context: o.context,
		// The default namespace is omitted so the wire format is unchanged for projects that
		// use none (the API treats "no namespace" as the default).
		Namespace:       "",
		ForceTemporary:  o.forceTemporary,
		Languages:       c.cfg.Languages.Supported,
		PrimaryLanguage: c.cfg.Languages.Primary,
		OriginLanguage:  ResolveOriginLanguage(o.originLanguage, c.cfg.Languages.Primary),
	}
	if namespace != DefaultNamespace {
		body.Namespace = namespace
	}
	if body.Languages == nil {
		body.Languages = []string{}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	url := c.apiURL + "/translate"
	c.debugf("POST %s %s", url, payload)
	res := c.tr.do(ctx, http.MethodPost, url, c.headers(""), payload)
	if !res.OK {
		return nil, errors.New(res.Error)
	}
	if res.Message != "" {
		c.logf("i18n-keyless: %s", res.Message)
	}
	var parsed translateResponse
	if err := json.Unmarshal(res.Body, &parsed); err != nil {
		return nil, err
	}
	byLang := make(map[string]string, len(parsed.Data.Translation.Languages))
	for lang, text := range parsed.Data.Translation.Languages {
		if text != nil && *text != "" {
			byLang[lang] = *text
		}
	}
	// Feed the store, otherwise every later call for this key POSTs again, forever.
	c.cache(storageKey, byLang)
	return byLang, nil
}

// headers is the exact application header set of every request (PROTOCOL.md section 3.2).
// A server sends no `unique_id`: the API counts it by its connection, which it cannot
// shape; any id this process invented would be wrong in one direction or the other.
func (c *Client) headers(etag string) map[string]string {
	h := map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + c.cfg.APIKey,
		"Version":       Version,
		"sdk":           SDK,
	}
	if etag != "" {
		h["If-None-Match"] = etag
	}
	return h
}

// allLanguagesResponse is the `GET /translate/` answer: dictionaries keyed by language
// code then storage key.
type allLanguagesResponse struct {
	Data struct {
		Translations map[string]map[string]string `json:"translations"`
	} `json:"data"`
}

// refetch loads every language's dictionary of one namespace and merges it into the store.
// A failure is logged and changes nothing: the store keeps what it has.
func (c *Client) refetch(ctx context.Context, namespace string) {
	if c.cfg.GetAllTranslationsForAllLanguages != nil {
		byLang, err := c.cfg.GetAllTranslationsForAllLanguages(ctx)
		if err != nil {
			c.logf("i18n-keyless: fetch all translations error: %v", err)
			return
		}
		c.merge(byLang)
		return
	}
	res := c.fetchDictionary(ctx, "", namespace)
	if !res.OK {
		if res.Error != "" {
			c.logf("i18n-keyless: fetch all translations error: %s", res.Error)
		}
		return
	}
	if res.NotModified {
		return
	}
	var parsed allLanguagesResponse
	if err := json.Unmarshal(res.Body, &parsed); err != nil {
		c.logf("i18n-keyless: fetch all translations error: %v", err)
		return
	}
	c.merge(parsed.Data.Translations)
}

// merge adds dictionaries to the store: new values win, keys are never removed, languages
// the port does not know are dropped.
func (c *Client) merge(byLang map[string]map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for lang, dictionary := range byLang {
		if !IsLang(lang) {
			continue
		}
		for storageKey, text := range dictionary {
			c.translations[lang][storageKey] = text
		}
	}
}

// fetchDictionary performs a dictionary GET: `GET /translate/` (every language) when lang is
// "", `GET /translate/<lang>` otherwise, with the ETag of the previous answer replayed as
// If-None-Match. The cursor is never stored (it is global while fetches are per namespace),
// so the URL always carries an empty `last_refresh` when no ETag is known, like the node SDK.
// A 200 remembers the answer's ETag; a `message` is logged as a warning.
func (c *Client) fetchDictionary(ctx context.Context, lang, namespace string) result {
	if c.cfg.APIKey == "" && c.cfg.APIURL == "" {
		c.logf("i18n-keyless: No config found")
		return result{}
	}
	etagKey := EtagCacheKey(c.cfg.APIKey, lang, namespace)
	c.mu.Lock()
	etag := c.etags[etagKey]
	c.mu.Unlock()
	empty := ""
	url := BuildDictionaryURL(c.apiURL, lang, &empty, namespace, etag)
	c.debugf("GET %s", url)
	res := c.tr.do(ctx, http.MethodGet, url, c.headers(etag), nil)
	if res.OK && !res.NotModified {
		if res.Etag != "" {
			c.mu.Lock()
			c.etags[etagKey] = res.Etag
			c.mu.Unlock()
		}
		if res.Message != "" {
			c.logf("i18n-keyless: %s", res.Message)
		}
	}
	return res
}

// recordUsage stamps today's UTC date on a storage key and schedules the flush when the
// date changed. Transient namespaces are never recorded.
func (c *Client) recordUsage(namespace, storageKey string, unpersisted bool) {
	if unpersisted || c.cfg.DisableUsage {
		return
	}
	today := c.now().UTC().Format("2006-01-02")
	c.mu.Lock()
	defer c.mu.Unlock()
	bucket := c.usage[namespace]
	if bucket == nil {
		bucket = map[string]string{}
		c.usage[namespace] = bucket
	}
	if bucket[storageKey] == today {
		return
	}
	bucket[storageKey] = today
	if c.usageTimer == nil {
		c.usageTimer = time.AfterFunc(c.usageDebounce, func() {
			c.mu.Lock()
			c.usageTimer = nil
			c.mu.Unlock()
			if err := c.FlushUsage(context.Background()); err != nil {
				c.logf("i18n-keyless: send translations usage error: %v", err)
			}
		})
	}
}

// usageRequest is the `POST /translate/last-used-translations` body.
type usageRequest struct {
	PrimaryLanguage              string                       `json:"primaryLanguage"`
	TranslationsUsageByNamespace map[string]map[string]string `json:"translationsUsageByNamespace"`
}

// FlushUsage sends the usage map now instead of on the debounce: for a script that exits
// before the 10 s window. Nothing is sent for an empty map or without an API key; the map is
// never cleared. The custom SendTranslationsUsage handler, when set, receives the default
// namespace's bucket only.
func (c *Client) FlushUsage(ctx context.Context) error {
	if c.cfg.APIKey == "" {
		c.logf("i18n-keyless: No config found")
		return nil
	}
	snapshot := c.usageSnapshot()
	if len(snapshot) == 0 {
		return nil
	}
	if c.cfg.SendTranslationsUsage != nil {
		bucket := snapshot[DefaultNamespace]
		if bucket == nil {
			bucket = map[string]string{}
		}
		return c.cfg.SendTranslationsUsage(ctx, bucket)
	}
	payload, err := json.Marshal(usageRequest{PrimaryLanguage: c.cfg.Languages.Primary, TranslationsUsageByNamespace: snapshot})
	if err != nil {
		return err
	}
	res := c.tr.do(ctx, http.MethodPost, c.apiURL+"/translate/last-used-translations", c.headers(""), payload)
	if !res.OK {
		return errors.New(res.Error)
	}
	if res.Message != "" {
		c.logf("i18n-keyless: %s", res.Message)
	}
	return nil
}

func (c *Client) usageSnapshot() map[string]map[string]string {
	c.mu.Lock()
	defer c.mu.Unlock()
	snapshot := make(map[string]map[string]string, len(c.usage))
	for namespace, bucket := range c.usage {
		copied := make(map[string]string, len(bucket))
		for k, v := range bucket {
			copied[k] = v
		}
		snapshot[namespace] = copied
	}
	return snapshot
}

func (c *Client) logf(format string, v ...any) {
	c.logger.Printf(format, v...)
}

func (c *Client) debugf(format string, v ...any) {
	if c.cfg.Debug {
		c.logger.Printf("i18n-keyless: "+format, v...)
	}
}
