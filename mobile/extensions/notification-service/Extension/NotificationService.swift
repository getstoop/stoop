import Foundation
import UserNotifications

// Runs for each push before it is shown, the phone locked or not, the
// app in front or not. The relay's notification says only "New
// activity" and carries the Web Push body in "c"; this opens it with
// the key pair of the server it came from and writes what the app's own
// notification would say (PushWords), with where a tap goes.
//
// A push it cannot read is still shown, since without the notification
// filtering entitlement an extension cannot show nothing, but quietly:
// the relay's line, no sound, passive, and stacked with the others of
// its kind. That is what a push from a server since removed gets (its
// keys are gone), and one that arrives before the phone's first unlock.
final class NotificationService: UNNotificationServiceExtension {
  // Unreadable pushes stack under one thread, apart from any server's.
  private static let unreadableThread = "stoop-unreadable"

  private let lock = NSLock()
  private var deliver: ((UNNotificationContent) -> Void)?
  private var fallback: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    let quiet = NotificationService.quiet(request.content)
    lock.lock()
    deliver = contentHandler
    fallback = quiet
    lock.unlock()
    finish(NotificationService.written(request.content) ?? quiet)
  }

  // The system is about to give up waiting.
  override func serviceExtensionTimeWillExpire() {
    lock.lock()
    let quiet = fallback
    lock.unlock()
    if let quiet { finish(quiet) }
  }

  // Hands the content over, once.
  private func finish(_ content: UNNotificationContent) {
    lock.lock()
    let handler = deliver
    deliver = nil
    lock.unlock()
    handler?(content)
  }

  // The notification as the app would have written it, or nil when the
  // push can't be read.
  private static func written(_ original: UNNotificationContent) -> UNNotificationContent? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "StoopAppGroup") as? String,
      let body = original.userInfo["c"] as? String,
      let payload = PushReader.read(body: body, keys: PushKeyItems.all(group: group)),
      let content = original.mutableCopy() as? UNMutableNotificationContent
    else { return nil }

    let mirror = PushMirror(json: stored(PushMirror.storeKey, group: group))
    let words = PushWords(payload, mirror.settings(serverId: payload.serverId))
    content.title = words.title
    content.subtitle = words.subtitle
    content.body = words.body
    content.sound = .default
    content.threadIdentifier = payload.serverId
    // Where expo-notifications reads a remote notification's data on a
    // tap: userInfo["body"], a dictionary.
    content.userInfo["body"] = payload.data
    content.userInfo.removeValue(forKey: "c")
    // The icon's badge is every saved server's count added up, and the
    // payload has this server's alone: set only when it is the only one.
    if mirror.isOnlyServer(payload.serverId), payload.waiting >= 0 {
      content.badge = NSNumber(value: payload.waiting)
    }
    return content
  }

  // The relay's own line, shown without drawing attention.
  //
  // FILTERING ENTITLEMENT: once Apple grants
  // com.apple.developer.usernotifications.filtering, "show nothing" goes
  // here: hand back an empty UNNotificationContent() instead.
  private static func quiet(_ original: UNNotificationContent) -> UNNotificationContent {
    guard let content = original.mutableCopy() as? UNMutableNotificationContent else { return original }
    content.sound = nil
    content.interruptionLevel = .passive
    content.threadIdentifier = unreadableThread
    content.userInfo.removeValue(forKey: "c")
    return content
  }

  // A value from the app group's store (PushGroupStore.swift in
  // modules/stoop-push-keys): store/<key>.json in the group's container.
  private static func stored(_ key: String, group: String) -> Data? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      return nil
    }
    return try? Data(contentsOf: container.appendingPathComponent("store").appendingPathComponent("\(key).json"))
  }
}
