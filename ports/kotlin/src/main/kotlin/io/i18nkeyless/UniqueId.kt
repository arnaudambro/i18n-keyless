package io.i18nkeyless

import java.security.SecureRandom
import java.util.Random

/**
 * The `unique_id` header is what the API counts as "a user".
 *
 * On a device there is no server-side signal to count by (NAT, roaming), so the id is
 * generated here before the first request leaves, and persisted in storage. Its shape is
 * the one the API itself mints: 16 characters of a 63-character alphabet.
 */
const val UNIQUE_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"
const val UNIQUE_ID_LENGTH = 16

/**
 * Bytes at or above the largest multiple of 63 are drawn again, so no character of the
 * alphabet is favoured (the rejection sampling nanoid does).
 */
const val UNIQUE_ID_LARGEST_USABLE_BYTE = 252 // 256 - (256 % 63)

private val secureRandom: Random by lazy {
    try {
        SecureRandom()
    } catch (_: Throwable) {
        // A platform without a secure source: 96 bits from the default PRNG still keep
        // devices apart.
        Random()
    }
}

/** Generates a device id with the same shape as one the API would have minted. */
fun generateUniqueId(random: Random = secureRandom): String {
    val out = StringBuilder(UNIQUE_ID_LENGTH)
    while (out.length < UNIQUE_ID_LENGTH) {
        val byte = random.nextInt(256)
        if (byte >= UNIQUE_ID_LARGEST_USABLE_BYTE) continue
        out.append(UNIQUE_ID_ALPHABET[byte % UNIQUE_ID_ALPHABET.length])
    }
    return out.toString()
}

/**
 * True for a value usable as the header: a non-empty string of at most 64 printable ASCII
 * characters, no space (a newline in a header value makes the HTTP client throw).
 */
fun isUniqueId(value: Any?): Boolean =
    value is String && value.isNotEmpty() && value.length <= 64 && value.all { it.code in 0x21..0x7E }
