import Foundation

// The payload a push decrypts to, version 1
// (docs/architecture/push-payload.md): every field always present, an
// unknown version refused, unknown fields ignored.
struct PushPayload: Equatable {
  static let version = 1

  let serverId: String
  let itemId: String
  let kind: Int
  let spaceId: String
  let channelId: String
  let threadRootId: String
  let messageId: String
  let actorName: String
  let preview: String
  let spaceName: String
  let channelName: String
  let waiting: Int

  // Nil for anything that is not a whole version 1 payload: not JSON, a
  // missing or mistyped field, or an ID a tap can't do without left
  // empty (as the app's notificationData refuses it).
  init?(json: Data) {
    guard let object = (try? JSONSerialization.jsonObject(with: json)) as? [String: Any],
      PushPayload.integer(object["v"]) == PushPayload.version,
      let serverId = object["serverId"] as? String, !serverId.isEmpty,
      let itemId = object["itemId"] as? String, !itemId.isEmpty,
      let kind = PushPayload.integer(object["kind"]),
      let spaceId = object["spaceId"] as? String,
      let channelId = object["channelId"] as? String, !channelId.isEmpty,
      let threadRootId = object["threadRootId"] as? String,
      let messageId = object["messageId"] as? String, !messageId.isEmpty,
      let actorName = object["actorName"] as? String,
      let preview = object["preview"] as? String,
      let spaceName = object["spaceName"] as? String,
      let channelName = object["channelName"] as? String,
      let waiting = PushPayload.integer(object["waiting"])
    else { return nil }
    self.serverId = serverId
    self.itemId = itemId
    self.kind = kind
    self.spaceId = spaceId
    self.channelId = channelId
    self.threadRootId = threadRootId
    self.messageId = messageId
    self.actorName = actorName
    self.preview = preview
    self.spaceName = spaceName
    self.channelName = channelName
    self.waiting = waiting
  }

  // The app's NotificationData (mobile/src/notifications/content.ts):
  // where a tap goes. The kind stays a JSON number.
  var data: [String: Any] {
    [
      "serverId": serverId,
      "itemId": itemId,
      "kind": kind,
      "spaceId": spaceId,
      "channelId": channelId,
      "threadRootId": threadRootId,
      "messageId": messageId,
    ]
  }

  // A JSON whole number. JSONSerialization hands true and false over as
  // numbers too, so those are told apart and refused.
  private static func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return Int(exactly: number.doubleValue)
  }
}
