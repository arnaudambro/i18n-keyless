package i18nkeyless

// callOptions are the per-call options of T and Translate, the `TranslationOptions` of the
// JavaScript SDKs.
type callOptions struct {
	context        string
	namespace      string
	unpersisted    bool
	forceTemporary map[string]string
	replace        map[string]string
	replaceOrder   []string
	originLanguage string
}

// Option configures one T or Translate call.
type Option func(*callOptions)

// WithContext disambiguates a source text that has two meanings: "8 heures" is "8 AM" on a
// clock and "8 hours" in a duration. The translation is stored as `key__context`, the same
// entry every other SDK and the dashboard use.
func WithContext(context string) Option {
	return func(o *callOptions) { o.context = context }
}

// WithNamespace puts the translation in a namespace: an independently fetched and stored
// slice of the project. Absent, Config.DefaultNamespace applies, then `default`.
func WithNamespace(namespace string) Option {
	return func(o *callOptions) { o.namespace = namespace }
}

// WithUnpersistedNamespace marks the call's namespace as transient (one namespace per chat,
// say): usage analytics are not recorded for it. This port keeps every dictionary in memory
// anyway, so nothing else changes, exactly like the node SDK.
func WithUnpersistedNamespace() Option {
	return func(o *callOptions) { o.unpersisted = true }
}

// WithForceTemporary overwrites the stored translation of the given languages with your own
// text: `{"en": "Hi there"}`. The value travels to the API, which stores it permanently
// (the AI never rewrites a non-empty cell); the name is historical. A call carrying it is
// always sent, even for a key the store already holds.
func WithForceTemporary(byLang map[string]string) Option {
	return func(o *callOptions) { o.forceTemporary = byLang }
}

// WithReplace substitutes placeholders in the resolved text: `{"{{name}}": "Ada"}` turns
// "Hello {{name}}" into "Hello Ada". Placeholders are literal strings, every occurrence is
// replaced in one pass, and an empty replacement leaves the placeholder in place.
func WithReplace(replace map[string]string) Option {
	return func(o *callOptions) { o.replace = replace; o.replaceOrder = nil }
}

// WithReplaceOrdered is WithReplace with an explicit priority between placeholders that can
// match at the same position ("{{a}}" and "{{a}}x"): the first of the slice wins.
func WithReplaceOrdered(placeholders []string, replace map[string]string) Option {
	return func(o *callOptions) { o.replace = replace; o.replaceOrder = placeholders }
}

// WithOriginLanguage declares user generated content: the key is written in that language,
// not in the primary one. The API translates it into the primary language, keeps the raw
// text for viewers of the origin language and translates every other. Viewed in its origin
// language the key is returned as is, with no request.
func WithOriginLanguage(lang string) Option {
	return func(o *callOptions) { o.originLanguage = lang }
}

func applyOptions(opts []Option) callOptions {
	var o callOptions
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	return o
}

// replaced applies the call's replace option to a text.
func (o *callOptions) replaced(text string) string {
	if o.replaceOrder != nil {
		return ApplyReplaceOrdered(text, o.replaceOrder, o.replace)
	}
	return ApplyReplace(text, o.replace)
}
