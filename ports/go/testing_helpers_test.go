package i18nkeyless

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// scriptedAnswer is one transport outcome, in the vocabulary of the conformance vectors:
// a status with an optional status text, headers and JSON body; or a network error; or a
// timeout; or a 200 whose body does not parse.
type scriptedAnswer struct {
	Status       int
	StatusText   string
	Headers      map[string]string
	Body         any
	NetworkError string
	Timeout      bool
	InvalidJSON  bool
	// Block, when non-nil, holds the answer until the channel is closed (concurrency tests).
	Block <-chan struct{}
}

// recordedRequest is what the scripted transport saw: method, URL, the application header
// set and the parsed JSON body.
type recordedRequest struct {
	Method  string
	URL     string
	Headers map[string]string
	Body    map[string]any
	RawBody string
}

// scriptedTransport answers each request with the next scripted answer (the last one
// repeats) and records every request. It never touches the network.
type scriptedTransport struct {
	mu       sync.Mutex
	answers  []scriptedAnswer
	next     int
	Requests []recordedRequest
	active   int
	Peak     int
}

func newScripted(answers ...scriptedAnswer) *scriptedTransport {
	return &scriptedTransport{answers: answers}
}

func (s *scriptedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	s.mu.Lock()
	rec := recordedRequest{Method: req.Method, URL: req.URL.String(), Headers: map[string]string{}}
	for name, values := range req.Header {
		rec.Headers[name] = values[0]
	}
	if req.Body != nil {
		raw, _ := io.ReadAll(req.Body)
		rec.RawBody = string(raw)
		_ = json.Unmarshal(raw, &rec.Body)
	}
	s.Requests = append(s.Requests, rec)
	answer := s.answers[len(s.answers)-1]
	if s.next < len(s.answers) {
		answer = s.answers[s.next]
	}
	s.next++
	s.active++
	if s.active > s.Peak {
		s.Peak = s.active
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.active--
		s.mu.Unlock()
	}()

	if answer.Block != nil {
		select {
		case <-answer.Block:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
	}
	if answer.NetworkError != "" {
		return nil, errors.New(answer.NetworkError)
	}
	if answer.Timeout {
		return nil, context.DeadlineExceeded
	}
	body := ""
	if answer.InvalidJSON {
		body = "{not json"
	} else if answer.Body != nil {
		raw, _ := json.Marshal(answer.Body)
		body = string(raw)
	}
	resp := &http.Response{
		StatusCode: answer.Status,
		Status:     strings.TrimSpace(strconv.Itoa(answer.Status) + " " + answer.StatusText),
		Header:     http.Header{},
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Request:    req,
	}
	for name, value := range answer.Headers {
		resp.Header.Set(name, value)
	}
	return resp, nil
}

// count returns how many recorded requests match the method and URL suffix.
func (s *scriptedTransport) count(method, urlSuffix string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.Requests {
		if r.Method == method && strings.HasSuffix(r.URL, urlSuffix) {
			n++
		}
	}
	return n
}

func (s *scriptedTransport) requests() []recordedRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]recordedRequest(nil), s.Requests...)
}

// testLogger collects the port's log lines.
type testLogger struct {
	mu    sync.Mutex
	lines []string
}

func (l *testLogger) Printf(format string, v ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, strings.TrimSpace(fmt.Sprintf(format, v...)))
}

func (l *testLogger) contains(substr string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, line := range l.lines {
		if strings.Contains(line, substr) {
			n++
		}
	}
	return n
}

// newTestClient builds a client on a scripted transport with a recorded sleeper (no real
// backoff) and a pinned clock. It does not run the boot fetch.
func newTestClient(t *testing.T, cfg Config, script *scriptedTransport) (*Client, *[]time.Duration, *testLogger) {
	t.Helper()
	logger := &testLogger{}
	if cfg.Logger == nil {
		cfg.Logger = logger
	}
	cfg.HTTPClient = &http.Client{Transport: script}
	if cfg.Languages.Primary == "" {
		cfg.Languages = Languages{Primary: "fr", Supported: []string{"fr", "en", "es"}}
	}
	c, err := New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	var sleeps []time.Duration
	c.tr.sleep = func(_ context.Context, d time.Duration) { sleeps = append(sleeps, d) }
	c.now = func() time.Time { return time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC) }
	c.usageDebounce = time.Hour
	t.Cleanup(c.Close)
	return c, &sleeps, logger
}

// seed puts translations in the store for one language.
func (c *Client) seed(lang string, translations map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k, v := range translations {
		c.translations[lang][k] = v
	}
}

// okTranslate is a `POST /translate` answer carrying the given translations in `languages`.
func okTranslate(byLang map[string]any) scriptedAnswer {
	if byLang == nil {
		byLang = map[string]any{}
	}
	return scriptedAnswer{Status: 200, StatusText: "OK", Body: map[string]any{
		"ok": true, "error": "", "message": "",
		"data": map[string]any{"translation": map[string]any{"languages": byLang, "id": 4213}},
	}}
}

// okAll is a `GET /translate/` answer with dictionaries by language.
func okAll(byLang map[string]map[string]string, etag string) scriptedAnswer {
	headers := map[string]string{}
	if etag != "" {
		headers["ETag"] = etag
	}
	return scriptedAnswer{Status: 200, StatusText: "OK", Headers: headers, Body: map[string]any{
		"ok": true, "error": "", "message": "",
		"data": map[string]any{"translations": byLang, "uniqueId": "srv_x", "lastRefresh": "1756209600000"},
	}}
}

// applicationHeaders drops the headers Go's http.Client adds on its own (User-Agent,
// Accept-Encoding, Content-Length, Host), leaving the set the port chose.
func applicationHeaders(h map[string]string) map[string]string {
	out := map[string]string{}
	for name, value := range h {
		switch http.CanonicalHeaderKey(name) {
		case "User-Agent", "Accept-Encoding", "Content-Length", "Host", "Connection":
			continue
		}
		out[http.CanonicalHeaderKey(name)] = value
	}
	return out
}

// expectHeaders compares a recorded header set with a vector's, after the vector's
// placeholders are resolved for this port: `$SDK_VERSION` is Version, the `sdk` label is
// `go`, and `unique_id` is never sent by a server.
func expectHeaders(t *testing.T, name string, got map[string]string, expected map[string]any) {
	t.Helper()
	want := map[string]string{}
	for k, v := range expected {
		if k == "unique_id" {
			continue
		}
		value := v.(string)
		if value == "$SDK_VERSION" {
			value = Version
		}
		if k == "sdk" {
			value = SDK
		}
		want[http.CanonicalHeaderKey(k)] = value
	}
	got = applicationHeaders(got)
	if len(got) != len(want) {
		t.Errorf("%s: header set %v, want %v", name, got, want)
		return
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s: header %s = %q, want %q", name, k, got[k], v)
		}
	}
}
