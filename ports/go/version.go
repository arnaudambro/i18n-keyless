package i18nkeyless

// Version is the semantic version of this port, sent as the `Version` header on every
// request. The API reads its major to pick the language-code dialect of its answers: a
// major >= 3 gets the v3 codes (`zh-Hans`, `cs`). It tracks the shared version of every
// i18n-keyless SDK and is written by `scripts/set-version.mjs` at the repository root.
const Version = "3.6.1"

// SDK is the `sdk` header value: the runtime label the API counts this process under. `go`
// is registered on the API as a server label, so a process is counted by its connection
// and never sends a device id (PROTOCOL.md section 10.1).
const SDK = "go"
