import Foundation

/// The `unique_id` header is what the API counts as "a user".
///
/// On a device there is no server-side signal to count by (NAT, roaming), so the id is
/// generated here before the first request leaves, and persisted in storage. Its shape is
/// the one the API itself mints: 16 characters of a 63-character alphabet.
enum UniqueId {
    static let alphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz")
    static let length = 16
    /// Bytes at or above the largest multiple of 63 are drawn again, so no character of the
    /// alphabet is favoured (the rejection sampling nanoid does).
    static let largestUsableByte = 256 - (256 % alphabet.count) // 252

    /// Generates a device id with the same shape as one the API would have minted.
    /// `SystemRandomNumberGenerator` is the platform's cryptographic source.
    static func generate() -> String {
        var generator = SystemRandomNumberGenerator()
        var id = ""
        id.reserveCapacity(length)
        while id.count < length {
            let byte = Int(UInt8.random(in: 0...255, using: &generator))
            if byte >= largestUsableByte { continue }
            id.append(alphabet[byte % alphabet.count])
        }
        return id
    }

    /// True for a value usable as the header: non-empty, at most 64 characters, every one
    /// printable ASCII (a newline in a header value makes the HTTP client throw).
    static func isValid(_ value: String?) -> Bool {
        guard let value = value, !value.isEmpty, value.utf8.count <= 64 else { return false }
        return value.utf8.allSatisfy { $0 >= 0x21 && $0 <= 0x7E }
    }
}
