import 'dart:math';

/// The `unique_id` header is what the API counts as "a user".
///
/// On a device there is no server-side signal to count by (NAT, roaming), so the id is
/// generated here before the first request leaves, and persisted in storage. Its shape
/// is the one the API itself mints: 16 characters of a 63-character alphabet.
const String _alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const int _idLength = 16;

/// Bytes at or above the largest multiple of 63 are drawn again, so no character of the
/// alphabet is favoured (the rejection sampling nanoid does).
final int _largestUsableByte = 256 - (256 % _alphabet.length); // 252

/// The secure random source. A test replaces it with one that throws to exercise
/// the fallback of a platform without a secure source.
Random Function() secureRandomFactory = Random.secure;

Random _random() {
  try {
    return secureRandomFactory();
  } catch (_) {
    // Some platforms have no secure source; 96 bits from the default PRNG still keep
    // devices apart.
    return Random();
  }
}

/// Generates a device id with the same shape as one the API would have minted.
String generateUniqueId() {
  final random = _random();
  final buffer = StringBuffer();
  while (buffer.length < _idLength) {
    final byte = random.nextInt(256);
    if (byte >= _largestUsableByte) continue;
    buffer.write(_alphabet[byte % _alphabet.length]);
  }
  return buffer.toString();
}

final RegExp _nonPrintableAscii = RegExp(r'[^\x21-\x7e]');

/// True for a value usable as the header: non-empty, at most 64 printable ASCII
/// characters (a newline in a header value makes the HTTP client throw).
bool isUniqueId(Object? value) =>
    value is String &&
    value.isNotEmpty &&
    value.length <= 64 &&
    !_nonPrintableAscii.hasMatch(value);
