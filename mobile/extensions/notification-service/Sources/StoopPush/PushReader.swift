import Foundation

// From what the relay hands Apple to the payload inside. A push names no
// subscription, so every key pair the phone holds is tried until one
// opens it: a wrong key fails the tag. The key's ID is the app's local
// ID for its server, which the payload must name too.
enum PushReader {
  struct Candidate {
    // The keychain item's account: the local server ID.
    let id: String
    // The item's 48 bytes (WebPush.Keys).
    let stored: Data
  }

  // Nil when the body is not base64, no key opens it, what is inside is
  // not a payload this version reads, or it names another server than
  // the key that opened it.
  static func read(body: String, keys: [Candidate]) -> PushPayload? {
    guard let message = Data(base64Encoded: body) else { return nil }
    for candidate in keys {
      guard let pair = WebPush.Keys(stored: candidate.stored) else { continue }
      do {
        let plain = try WebPush.open(message, with: pair)
        guard let payload = PushPayload(json: plain), payload.serverId == candidate.id else { return nil }
        return payload
      } catch WebPush.Failure.notOurs {
        continue
      } catch {
        return nil
      }
    }
    return nil
  }
}
