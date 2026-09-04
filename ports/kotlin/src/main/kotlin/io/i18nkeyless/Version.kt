package io.i18nkeyless

/**
 * The library version, sent as the `Version` header on every request.
 *
 * The API reads the major of this header to pick the dialect of the language codes it
 * answers with: `>= 3` means the v3 codes (`zh-Hans`, `cs`), anything else the v2 codes
 * (`cn`, `cz`). This port speaks v3, so it shares the JavaScript SDKs' version line. Keep it
 * equal to `version` in `build.gradle.kts` (`scripts/set-version.mjs` rewrites both).
 */
const val VERSION = "3.6.1"

/**
 * The `sdk` header of a device: an Android app, a desktop app, a JVM process that acts for
 * one user. Counted by the API through its persisted `unique_id` (protocol section 10.1).
 */
const val SDK_RUNTIME_CLIENT = "kotlin-client"

/**
 * The `sdk` header of a server (Ktor, Spring, a build step): no `unique_id`, counted by its
 * connection, no usage analytics. Every label ending in `-server` is a server for the API.
 */
const val SDK_RUNTIME_SERVER = "kotlin-server"

/** The official API. */
const val DEFAULT_API_URL = "https://api.i18n-keyless.com"

/** The namespace used when none is given. It reuses the legacy storage keys. */
const val DEFAULT_NAMESPACE = "default"
