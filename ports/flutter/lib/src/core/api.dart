import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Waits [duration]. Injectable so tests replay the backoff schedule without waiting.
typedef Sleep = Future<void> Function(Duration duration);

/// One HTTP answer, already reduced to what the client needs. Never throws.
class ApiResult {
  const ApiResult({
    required this.ok,
    this.statusCode,
    this.json,
    this.etag,
    this.error = '',
    this.notModified = false,
  });

  /// `ok` of the JSON body on a `200`, `true` on a `304`, `false` otherwise.
  final bool ok;
  final int? statusCode;
  final Map<String, dynamic>? json;

  /// The `ETag` header of a `200`.
  final String? etag;
  final String error;

  /// The API answered `304 Not Modified`: the caller's copy is current.
  final bool notModified;

  String get message => json?['message']?.toString() ?? '';
}

/// One shared request path for every API call, with the resilience a bare request
/// lacks:
///
/// - a timeout of 10 s (an app must never hang on a slow translation API),
/// - retries with backoff (500 ms, then 1500 ms) on network errors, 429 and 5xx,
/// - no retry on other 4xx (a wrong key stays wrong; retrying only burns quota).
///
/// Errors never throw out of here: the caller always receives an [ApiResult] and falls
/// back to its stored translations.
class I18nKeylessApi {
  I18nKeylessApi({
    http.Client? client,
    Sleep? sleep,
    this.timeout = defaultTimeout,
    this.retryDelays = defaultRetryDelays,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _sleep = sleep ?? ((duration) => Future.delayed(duration));

  static const Duration defaultTimeout = Duration(seconds: 10);
  static const List<Duration> defaultRetryDelays = [
    Duration(milliseconds: 500),
    Duration(milliseconds: 1500),
  ];

  final http.Client _client;
  final bool _ownsClient;
  final Sleep _sleep;
  final Duration timeout;
  final List<Duration> retryDelays;

  /// Total attempts made through this instance, for tests.
  int attempts = 0;

  Future<ApiResult> get(Uri url, {required Map<String, String> headers}) =>
      _requestWithRetry('GET', url, headers: headers);

  Future<ApiResult> post(
    Uri url, {
    required Map<String, String> headers,
    required Object body,
  }) =>
      _requestWithRetry('POST', url, headers: headers, body: jsonEncode(body));

  Future<ApiResult> _requestWithRetry(
    String method,
    Uri url, {
    required Map<String, String> headers,
    String? body,
  }) async {
    var lastError = '';
    var lastStatus = 0;
    for (var attempt = 0; attempt <= retryDelays.length; attempt++) {
      attempts++;
      try {
        final request = http.Request(method, url);
        request.headers.addAll(headers);
        // bodyBytes, not body: the `body` setter appends `; charset=utf-8` to the
        // Content-Type, and the protocol wants the exact string `application/json`.
        if (body != null) request.bodyBytes = utf8.encode(body);
        final streamed = await _client.send(request).timeout(timeout);
        final response =
            await http.Response.fromStream(streamed).timeout(timeout);
        lastStatus = response.statusCode;
        // 304: the caller's copy is current. No body to parse, nothing to merge.
        if (response.statusCode == 304) {
          return ApiResult(ok: true, statusCode: 304, notModified: true);
        }
        if (response.statusCode == 200) {
          final decoded = jsonDecode(utf8.decode(response.bodyBytes));
          final json = decoded is Map<String, dynamic> ? decoded : null;
          return ApiResult(
            ok: json?['ok'] == true,
            statusCode: 200,
            json: json,
            etag: response.headers['etag'],
            error: json?['error']?.toString() ?? '',
          );
        }
        lastError = response.reasonPhrase?.isNotEmpty == true
            ? response.reasonPhrase!
            : 'HTTP ${response.statusCode}';
        // 4xx (except 429) is not transient: answer now, do not hammer the API.
        if (response.statusCode < 500 && response.statusCode != 429) {
          return ApiResult(
            ok: false,
            statusCode: response.statusCode,
            error: lastError,
          );
        }
      } on TimeoutException {
        lastError = 'timeout';
      } on http.ClientException catch (error) {
        lastError = error.message;
      } catch (error) {
        lastError = error.toString();
      }
      if (attempt < retryDelays.length) await _sleep(retryDelays[attempt]);
    }
    return ApiResult(
      ok: false,
      statusCode: lastStatus == 0 ? null : lastStatus,
      error: lastError,
    );
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
