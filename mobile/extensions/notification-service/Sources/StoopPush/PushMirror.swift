import Foundation

// What the app leaves in the app group's store for the wording of a
// push (mobile/src/push/mirror.ts writes it, under the key below):
//
//   { "showText": true,
//     "servers": { "<local server ID>": { "name": "Elm Street", "spaces": 3 } } }
//
// The store goes when the app is deleted while the keys stay, and a
// value may not have been written yet, so every part can be missing.
// What is missing is read the careful way: the text hidden, the server
// not named, the space named.
struct PushMirror {
  static let storeKey = "push-mirror"

  struct Server {
    let name: String
    // How many spaces the account is in there, when the app knew.
    let spaces: Int?
  }

  let showText: Bool?
  let servers: [String: Server]

  init(json: Data?) {
    let object = json.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } ?? [:]
    // A number is not a switch: only a JSON true or false counts.
    if let show = object["showText"] as? NSNumber, CFGetTypeID(show) == CFBooleanGetTypeID() {
      showText = show.boolValue
    } else {
      showText = nil
    }
    var servers: [String: Server] = [:]
    for (id, value) in object["servers"] as? [String: Any] ?? [:] {
      guard let server = value as? [String: Any] else { continue }
      let spaces = (server["spaces"] as? NSNumber).flatMap { Int(exactly: $0.doubleValue) }
      servers[id] = Server(name: server["name"] as? String ?? "", spaces: spaces)
    }
    self.servers = servers
  }

  // How a push from this server is worded.
  func settings(serverId: String) -> PushSettings {
    let server = servers[serverId]
    return PushSettings(
      showText: showText ?? false,
      serverName: server?.name ?? "",
      manyServers: servers.count > 1,
      manySpaces: server?.spaces.map { $0 > 1 } ?? true)
  }

  // Whether this server is the only one the phone has saved: only then
  // is its count of what waits the whole of the icon's badge.
  func isOnlyServer(_ serverId: String) -> Bool {
    servers.count == 1 && servers[serverId] != nil
  }
}
