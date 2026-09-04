# i18n-keyless Swift example

A two-screen SwiftUI app and a headless CLI, both driving the same `I18nKeyless` store:
`I18nKeylessText`, `I18nKeyless.t(...)`, `context`, `replace` and a language switcher.
Primary language is **French**; the SDK translates to English and Spanish.

It depends on the port by path (`../../ports/swift`), like every example in this repository.

## Run the CLI

Offline, against the bundled mock backend (no API key):

```bash
node ../_mock-server/server.mjs          # http://localhost:8787, in another terminal
swift run i18n-keyless-example-cli
```

Against the real service:

```bash
I18N_KEYLESS_API_KEY=your_key swift run i18n-keyless-example-cli
```

## The SwiftUI app

`Sources/App/DemoApp.swift` is a `DemoApp: App` with a two-tab `RootView`. Add it to an
iOS/macOS app target and use `DemoApp` as the entry point, or open the package in Xcode and
run a host app. The `App` target is a library so it compiles and is tested headless.

## Test

```bash
swift test
```

The test runs the CLI's store against a stubbed transport and asserts the switch resolves.
