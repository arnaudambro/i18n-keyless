package i18nkeyless

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// The network policy shared by every API call (PROTOCOL.md section 3.4): a per-attempt
// timeout, a fixed number of attempts, fixed backoff delays, and a result that is never an
// exception. An app must never hang on a slow translation API, and must never show empty
// text because it answered slowly.
const (
	// Timeout bounds one attempt. The whole call is bounded by MaxAttempts * Timeout plus
	// the backoff.
	Timeout = 10 * time.Second
	// MaxAttempts is the total number of attempts for one call: the first try plus one per
	// backoff delay.
	MaxAttempts = 3
	// timeoutErrorString is the error reported for a timed-out call.
	timeoutErrorString = "timeout"
)

// RetryDelays is the backoff before attempt 2 and attempt 3. Nothing is waited after the
// last attempt. No jitter, no exponential growth.
var RetryDelays = []time.Duration{500 * time.Millisecond, 1500 * time.Millisecond}

// IsRetryableStatus reports whether a non-200, non-304 HTTP status is retried. Only 429 and
// 5xx are transient; every other status (a 4xx, a 2xx other than 200, a 3xx other than 304)
// ends the call now: a wrong key stays wrong, retrying only burns quota.
func IsRetryableStatus(status int) bool {
	return status == 429 || status >= 500
}

// HTTPErrorMessage is the `error` string reported for a failed HTTP status: the status text,
// else `HTTP <code>`.
func HTTPErrorMessage(status int, statusText string) string {
	if statusText != "" {
		return statusText
	}
	return "HTTP " + strconv.Itoa(status)
}

// DecideStatus is what one HTTP status does to one attempt: `parse-body` (200), `not-modified`
// (304), `retry` (429, 5xx) or `fail` (anything else). The error string accompanies the last
// two. Pure, so the conformance vectors can be replayed against it.
func DecideStatus(status int, statusText string) (action string, errorText string) {
	switch {
	case status == 200:
		return "parse-body", ""
	case status == 304:
		return "not-modified", ""
	case IsRetryableStatus(status):
		return "retry", HTTPErrorMessage(status, statusText)
	default:
		return "fail", HTTPErrorMessage(status, statusText)
	}
}

// DelayAfter is the backoff after a failed attempt (1-based), and false when that attempt
// was the last: the call gives up at once.
func DelayAfter(failedAttempt int) (time.Duration, bool) {
	if failedAttempt < 1 || failedAttempt > len(RetryDelays) {
		return 0, false
	}
	return RetryDelays[failedAttempt-1], true
}

// result is what one call to the API produces. It is never an error: a failure is
// `OK == false` with `Error` set, and the caller keeps whatever it already holds.
type result struct {
	// OK is false on any transport failure or non-200 status; a 200 body with `"ok": false`
	// also sets it to false, with the body's `error`.
	OK bool
	// NotModified is true on a 304: nothing changed server-side, Body is empty.
	NotModified bool
	// Error is the status text, else `HTTP <code>`, else the network error, else `timeout`.
	Error string
	// Etag is the response's `ETag` header on a 200, to replay as `If-None-Match`.
	Etag string
	// Body is the raw 200 body, already known to be valid JSON.
	Body json.RawMessage
	// Message is the envelope's informational `message`, surfaced as a warning by the caller.
	Message string
}

// envelope is the common shape of every 200 body (PROTOCOL.md section 3.5).
type envelope struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

// transport performs the HTTP calls with the retry policy. The sleeper and the client are
// injectable so tests can drive the clock and script the wire.
type transport struct {
	client *http.Client
	sleep  func(context.Context, time.Duration)
	// timeout and delays default to the protocol constants; tests shorten them.
	timeout time.Duration
	delays  []time.Duration
}

func newTransport(client *http.Client) *transport {
	if client == nil {
		client = http.DefaultClient
	}
	return &transport{
		client: client,
		sleep: func(ctx context.Context, d time.Duration) {
			select {
			case <-time.After(d):
			case <-ctx.Done():
			}
		},
		timeout: Timeout,
		delays:  RetryDelays,
	}
}

// do sends one request with retries. `headers` is the exact application header set; the
// body is JSON when non-nil. It never returns an error: see result.
func (t *transport) do(ctx context.Context, method, url string, headers map[string]string, body []byte) result {
	lastError := ""
	attempts := len(t.delays) + 1
	for attempt := 0; attempt < attempts; attempt++ {
		res, done := t.attempt(ctx, method, url, headers, body)
		if done {
			return res
		}
		lastError = res.Error
		if attempt < len(t.delays) {
			t.sleep(ctx, t.delays[attempt])
		}
	}
	return result{Error: lastError}
}

// attempt performs one try. `done` is true when the call ends here: a 200 with a parsable
// body, a 304, or a non-retryable status.
func (t *transport) attempt(ctx context.Context, method, url string, headers map[string]string, body []byte) (result, bool) {
	attemptCtx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(attemptCtx, method, url, reader)
	if err != nil {
		return result{Error: err.Error()}, true
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	resp, err := t.client.Do(req)
	if err != nil {
		return result{Error: networkErrorMessage(err)}, false
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNotModified:
		// The caller's copy is current: no body to parse, nothing to merge.
		return result{OK: true, NotModified: true}, true
	case http.StatusOK:
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			return result{Error: networkErrorMessage(err)}, false
		}
		var env envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			// A 200 whose body does not parse counts as a failed attempt and is retried.
			return result{Error: err.Error()}, false
		}
		res := result{OK: env.OK, Error: env.Error, Message: env.Message, Body: raw, Etag: resp.Header.Get("ETag")}
		if !env.OK && res.Error == "" {
			res.Error = "ok: false"
		}
		return res, true
	}
	message := HTTPErrorMessage(resp.StatusCode, statusText(resp))
	if !IsRetryableStatus(resp.StatusCode) {
		return result{Error: message}, true
	}
	return result{Error: message}, false
}

// statusText is the reason phrase of a response: Go keeps it in `Status` as "<code> <text>".
func statusText(resp *http.Response) string {
	return strings.TrimSpace(strings.TrimPrefix(resp.Status, strconv.Itoa(resp.StatusCode)))
}

// networkErrorMessage maps a client error onto the protocol's error string: the literal
// `timeout` for a timed-out attempt, the error's own message otherwise.
func networkErrorMessage(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return timeoutErrorString
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return timeoutErrorString
	}
	// url.Error wraps the transport error with the method and URL; the reference reports
	// the bare message.
	var unwrapped interface{ Unwrap() error }
	for errors.As(err, &unwrapped) {
		inner := unwrapped.Unwrap()
		if inner == nil {
			break
		}
		err = inner
		if errors.Is(err, context.DeadlineExceeded) {
			return timeoutErrorString
		}
	}
	return err.Error()
}
