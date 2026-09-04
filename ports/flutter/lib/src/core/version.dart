/// The package version, sent as the `Version` header on every request.
///
/// The API reads the major of this header to pick the dialect of the language codes it
/// answers with: `>= 3` means the v3 codes (`zh-Hans`, `cs`), anything else means the v2
/// codes (`cn`, `cz`). This port speaks v3, so it shares the JavaScript SDKs' version
/// line. Keep it equal to `version:` in `pubspec.yaml`.
const String i18nKeylessVersion = '3.6.1';

/// The `sdk` header: what kind of client this is at runtime. A Flutter app is a device,
/// counted by its persisted `unique_id`. The protocol (docs/PROTOCOL.md, section 10.1)
/// gives this port the label `flutter`: the API treats every label that is not `node`,
/// `laravel` or `*-server` as a device.
const String i18nKeylessSdkRuntime = 'flutter';

/// The official API.
const String defaultApiUrl = 'https://api.i18n-keyless.com';
