import Foundation

// Small values the app leaves for the notification service extension,
// which cannot ask JavaScript anything: one file per key in the app
// group's container,
//
//   <container of group.<bundle ID>>/store/<key>.json
//
// holding the value's JSON text as UTF-8, replaced whole on each write
// and readable from the first unlock after a restart, as the keys are.
// Unlike the keychain, the container goes when the app is deleted, so
// nothing here is the only copy of something that must outlive that.
enum PushGroupStore {
  static func get(_ key: String, group: String) throws -> String? {
    let file = try url(key, group: group)
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    do {
      return String(decoding: try Data(contentsOf: file), as: UTF8.self)
    } catch {
      throw PushKeysFailedException("Could not read '\(key)' from the app group: \(error.localizedDescription)")
    }
  }

  static func set(_ key: String, value: String, group: String) throws {
    let file = try url(key, group: group)
    do {
      try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(value.utf8).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    } catch {
      throw PushKeysFailedException("Could not write '\(key)' to the app group: \(error.localizedDescription)")
    }
  }

  static func remove(_ key: String, group: String) throws {
    let file = try url(key, group: group)
    guard FileManager.default.fileExists(atPath: file.path) else { return }
    do {
      try FileManager.default.removeItem(at: file)
    } catch {
      throw PushKeysFailedException("Could not remove '\(key)' from the app group: \(error.localizedDescription)")
    }
  }

  private static func url(_ key: String, group: String) throws -> URL {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      throw PushKeysUnavailableException("the app is not signed for its app group")
    }
    return container.appendingPathComponent("store", isDirectory: true).appendingPathComponent("\(key).json")
  }
}
