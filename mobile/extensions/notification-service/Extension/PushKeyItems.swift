import Foundation
import Security

// Every push key pair the app has made, read from the keychain items it
// keeps under the app group (PushKeychain.swift in
// modules/stoop-push-keys): generic passwords, service
// "stoop-push-keys", the account the key's ID. The group is named: the
// extension's default keychain group is its own. Before the phone's
// first unlock after a restart the keychain answers nothing, and this is
// empty.
enum PushKeyItems {
  private static let service = "stoop-push-keys"

  static func all(group: String) -> [PushReader.Candidate] {
    var found: CFTypeRef?
    let list: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccessGroup as String: group,
      kSecMatchLimit as String: kSecMatchLimitAll,
      kSecReturnAttributes as String: true,
    ]
    guard SecItemCopyMatching(list as CFDictionary, &found) == errSecSuccess,
      let items = found as? [[String: Any]]
    else { return [] }
    return items.compactMap { item in
      guard let id = item[kSecAttrAccount as String] as? String, let stored = value(id, group: group) else {
        return nil
      }
      return PushReader.Candidate(id: id, stored: stored)
    }
  }

  private static func value(_ id: String, group: String) -> Data? {
    var found: CFTypeRef?
    let one: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: id,
      kSecAttrAccessGroup as String: group,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]
    guard SecItemCopyMatching(one as CFDictionary, &found) == errSecSuccess else { return nil }
    return found as? Data
  }
}
