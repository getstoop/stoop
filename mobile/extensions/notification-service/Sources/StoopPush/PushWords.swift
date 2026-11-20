import Foundation

// What decides a notification's words beside its payload.
struct PushSettings: Equatable {
  // Off, it says neither who nor what.
  let showText: Bool
  let serverName: String
  // More than one server saved on the phone: the server is named.
  let manyServers: Bool
  // The account is in more than one space there: the space is named.
  let manySpaces: Bool
}

// What a notification says. These are the rules of the app's own
// notifications (notificationContent in
// mobile/src/notifications/content.ts, with core's activityVerb), kept
// the same by one set of cases both run (cases/content.json).
struct PushWords: Equatable {
  let title: String
  // Empty when there is nowhere to name.
  let subtitle: String
  let body: String

  private static let directMessage = 3

  init(_ payload: PushPayload, _ settings: PushSettings) {
    let who = settings.showText && !payload.actorName.isEmpty ? payload.actorName : "Someone"
    if payload.kind == PushWords.directMessage {
      title = settings.showText ? who : "New direct message"
    } else {
      title = "\(who) \(PushWords.verb(payload.kind))"
    }
    // Where, nearest first.
    let places = [
      payload.channelName.isEmpty ? "" : "#\(payload.channelName)",
      settings.manySpaces ? payload.spaceName : "",
      settings.manyServers ? settings.serverName : "",
    ]
    subtitle = places.filter { !$0.isEmpty }.joined(separator: " · ")
    body = settings.showText ? payload.preview : ""
  }

  // chat.v1.ActivityKind: 2 a reply, 4 a thread's reply; a mention, and
  // any kind not known here, reads as a mention.
  private static func verb(_ kind: Int) -> String {
    switch kind {
    case 2: return "replied to you"
    case 4: return "replied in a thread"
    default: return "mentioned you"
    }
  }
}
