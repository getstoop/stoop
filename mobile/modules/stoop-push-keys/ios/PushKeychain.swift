import CryptoKit
import Foundation
import Security

// A Web Push subscription's keys (RFC 8291), one keychain item per ID.
//
// The item, which the notification service extension reads to decrypt
// (it must name the access group; its default group is its own):
//
//   class         kSecClassGenericPassword
//   service       "stoop-push-keys"
//   account       the ID, a string
//   access group  the app group, "group.<bundle ID>" (Info.plist
//                 StoopAppGroup); no team prefix
//   accessible    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
//   value         48 bytes: the P-256 private key's raw scalar (32,
//                 CryptoKit's rawRepresentation), then the auth secret (16)
//
// One item holds both, so a pair is there whole or not at all. The
// public half is never stored: it is derived from the private key each
// time it is asked for. The keychain outlives the app (an item is still
// there after the app is deleted and installed again) and the app
// group's files do not, so the item alone says whether an ID has keys.
enum PushKeychain {
  static let service = "stoop-push-keys"
  private static let privateLength = 32
  private static let authLength = 16

  struct Keys {
    let privateKey: P256.KeyAgreement.PrivateKey
    let auth: Data

    // The uncompressed point, 65 bytes: a subscription's p256dh.
    var p256dh: String { base64url(privateKey.publicKey.x963Representation) }
    var subscription: [String: String] { ["p256dh": p256dh, "auth": base64url(auth)] }
  }

  // Making keys is a read, then a write; one at a time, so two calls for
  // one ID get the same pair. Only the app makes keys: the extension
  // reads them.
  private static let lock = NSLock()

  // The ID's keys, made now if it has none. An item that is not a key
  // pair (nothing here writes one) is replaced.
  static func ensure(_ id: String, group: String) throws -> Keys {
    lock.lock()
    defer { lock.unlock() }
    if let keys = try read(id, group: group) { return keys }

    var auth = Data(count: authLength)
    let random = auth.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, authLength, $0.baseAddress!) }
    guard random == errSecSuccess else { throw failure("making an auth secret", random) }
    let keys = Keys(privateKey: P256.KeyAgreement.PrivateKey(), auth: auth)

    try remove(id, group: group)
    var item = query(id, group: group)
    item[kSecValueData as String] = keys.privateKey.rawRepresentation + auth
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { throw failure("storing keys", status) }
    return keys
  }

  // The ID's keys, or nil when it has none. Any other answer from the
  // keychain is thrown, never taken for "none": before the first unlock
  // after a restart the item is there and cannot be read, and must not
  // be made again.
  static func read(_ id: String, group: String) throws -> Keys? {
    var find = query(id, group: group)
    find[kSecMatchLimit as String] = kSecMatchLimitOne
    find[kSecReturnData as String] = true
    var found: CFTypeRef?
    let status = SecItemCopyMatching(find as CFDictionary, &found)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let value = found as? Data else { throw failure("reading keys", status) }
    guard value.count == privateLength + authLength,
      let privateKey = try? P256.KeyAgreement.PrivateKey(rawRepresentation: value.prefix(privateLength))
    else { return nil }
    return Keys(privateKey: privateKey, auth: Data(value.suffix(authLength)))
  }

  static func delete(_ id: String, group: String) throws {
    lock.lock()
    defer { lock.unlock() }
    try remove(id, group: group)
  }

  private static func remove(_ id: String, group: String) throws {
    let status = SecItemDelete(query(id, group: group) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw failure("deleting keys", status) }
  }

  private static func query(_ id: String, group: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: id,
      kSecAttrAccessGroup as String: group,
    ]
  }

  // -34018: the build is not entitled to the group (signed without it).
  private static func failure(_ doing: String, _ status: OSStatus) -> Error {
    if status == errSecMissingEntitlement {
      return PushKeysUnavailableException("the app is not signed for its app group")
    }
    // -25308: before the first unlock after a restart.
    if status == errSecInteractionNotAllowed { return PushKeysLockedException() }
    return PushKeysFailedException("The keychain refused \(doing) (status \(status))")
  }

  private static func base64url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
