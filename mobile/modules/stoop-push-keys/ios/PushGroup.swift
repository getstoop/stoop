import ExpoModulesCore
import Foundation

// The one group the app shares with its notification service extension:
// an app group, "group.<bundle ID>", which iOS also accepts as a keychain
// access group. The config plugin (mobile/plugins/withPushKeys.js) puts
// it in the entitlements and writes its name into Info.plist under
// StoopAppGroup, where the extension can read it too.
enum PushGroup {
  static func name() throws -> String {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "StoopAppGroup") as? String, !group.isEmpty else {
      throw PushKeysUnavailableException("Info.plist names no app group (StoopAppGroup)")
    }
    return group
  }

  // A key pair's ID and a stored value's key: a letter or digit, then
  // letters, digits, "-" and "_", 64 characters at most. The ID becomes a
  // keychain account and the key a file name, so nothing else is let in.
  static func check(_ name: String) throws {
    let bytes = Array(name.utf8)
    let alphanumeric = { (byte: UInt8) in
      (0x30...0x39).contains(byte) || (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
    }
    guard let first = bytes.first, alphanumeric(first), bytes.count <= 64,
      bytes.allSatisfy({ alphanumeric($0) || $0 == 0x2D || $0 == 0x5F })
    else {
      throw PushKeysInvalidNameException(name)
    }
  }
}

// The build has no shared group: made without the plugin, or signed
// without the app group.
final class PushKeysUnavailableException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_PUSH_KEYS_UNAVAILABLE" }
  override var reason: String { "Push keys are unavailable in this build: \(param)" }
}

final class PushKeysInvalidNameException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_PUSH_KEYS_INVALID_NAME" }
  override var reason: String { "Not a valid ID or key: '\(param)'" }
}

// Anything else the keychain or the file system refused.
final class PushKeysFailedException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_PUSH_KEYS_FAILED" }
  override var reason: String { param }
}
