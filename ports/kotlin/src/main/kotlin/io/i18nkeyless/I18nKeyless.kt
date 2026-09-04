package io.i18nkeyless

import java.util.concurrent.CompletableFuture

/**
 * The default client, for the common case of one project per process:
 *
 * ```
 * I18nKeyless.initBlocking(I18nKeylessConfig(apiKey = "...", languages = ...))
 * I18nKeyless.t("Bonjour")
 * ```
 *
 * Every member delegates to [client]. Create your own [I18nKeylessClient] instead when a
 * process serves several projects, or to inject a transport in a test.
 */
object I18nKeyless {
    @Volatile
    var client: I18nKeylessClient = I18nKeylessClient()

    fun init(config: I18nKeylessConfig): CompletableFuture<Unit> = client.init(config)

    fun initBlocking(config: I18nKeylessConfig) = client.initBlocking(config)

    val isInitialized: Boolean get() = client.isInitialized

    val currentLanguage: Lang get() = client.currentLanguage

    val supportedLanguages: List<Lang> get() = client.supportedLanguages

    /** The function path: no trim. */
    fun t(
        text: String,
        context: String? = null,
        namespace: String? = null,
        replace: Map<String, String>? = null,
        forceTemporary: Map<Lang, String>? = null,
        originLanguage: Lang? = null,
        unpersistedNamespace: Boolean = false,
        debug: Boolean = false,
    ): String = client.t(text, context, namespace, replace, forceTemporary, originLanguage, unpersistedNamespace, debug)

    /** The component path: trims the source text. */
    fun text(
        text: String,
        context: String? = null,
        namespace: String? = null,
        replace: Map<String, String>? = null,
        forceTemporary: Map<Lang, String>? = null,
        originLanguage: Lang? = null,
        unpersistedNamespace: Boolean = false,
        debug: Boolean = false,
    ): String = client.text(text, context, namespace, replace, forceTemporary, originLanguage, unpersistedNamespace, debug)

    fun setLanguage(lang: Lang): CompletableFuture<Unit> = client.setLanguage(lang)

    fun addListener(listener: () -> Unit) = client.addListener(listener)

    fun removeListener(listener: () -> Unit) = client.removeListener(listener)

    fun waitForIdle() = client.waitForIdle()

    fun clearStorage() = client.clearStorage()
}
