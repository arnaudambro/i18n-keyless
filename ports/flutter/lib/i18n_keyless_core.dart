/// The pure-Dart core of i18n-keyless: no Flutter import. Use it in a Dart CLI, a
/// server, or a test. Flutter apps import `package:i18n_keyless/i18n_keyless.dart`,
/// which re-exports this library.
library;

export 'src/core/api.dart' show ApiResult, I18nKeylessApi, Sleep;
export 'src/core/client.dart'
    show
        I18nKeylessClient,
        applyReplace,
        buildDictionaryUrl,
        etagCacheKey,
        queueIdFor,
        resolveNamespace,
        resolveOriginLanguage,
        storageKeyFor;
export 'src/core/langs.dart';
export 'src/core/pqueue.dart';
export 'src/core/storage.dart';
export 'src/core/types.dart';
export 'src/core/unique_id.dart' show generateUniqueId, isUniqueId;
export 'src/core/version.dart';
