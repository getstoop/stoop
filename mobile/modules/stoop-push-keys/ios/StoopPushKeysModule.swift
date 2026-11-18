import ExpoModulesCore

// What encrypted push needs on the phone before any push arrives: a
// P-256 key pair and an auth secret per subscription (PushKeychain.swift),
// and a few values the app leaves for the notification service extension
// (PushGroupStore.swift). Both are kept under the app group, so the
// extension can read them while the phone is locked.
//
// A private key never leaves this module: JavaScript gets the public
// half and the auth secret, which are what a subscription tells the
// server. Every function rejects with ERR_PUSH_KEYS_UNAVAILABLE in a
// build that has no app group, ERR_PUSH_KEYS_INVALID_NAME for an ID or
// key it will not take, ERR_PUSH_KEYS_LOCKED while the keychain is
// closed (before the first unlock), and ERR_PUSH_KEYS_FAILED for the
// rest.
public class StoopPushKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StoopPushKeys")

    // The ID's keys, made if it has none: { p256dh, auth }, base64url
    // without padding.
    AsyncFunction("ensureKeys") { (id: String) -> [String: String] in
      try PushGroup.check(id)
      return try PushKeychain.ensure(id, group: PushGroup.name()).subscription
    }

    // The ID's public key (p256dh), or nil when it has no keys.
    AsyncFunction("publicKey") { (id: String) -> String? in
      try PushGroup.check(id)
      return try PushKeychain.read(id, group: PushGroup.name())?.p256dh
    }

    AsyncFunction("deleteKeys") { (id: String) in
      try PushGroup.check(id)
      try PushKeychain.delete(id, group: PushGroup.name())
    }

    // The app group's store: a value is JSON text, as JavaScript wrote it.
    AsyncFunction("getItem") { (key: String) -> String? in
      try PushGroup.check(key)
      return try PushGroupStore.get(key, group: PushGroup.name())
    }

    AsyncFunction("setItem") { (key: String, value: String) in
      try PushGroup.check(key)
      try PushGroupStore.set(key, value: value, group: PushGroup.name())
    }

    AsyncFunction("removeItem") { (key: String) in
      try PushGroup.check(key)
      try PushGroupStore.remove(key, group: PushGroup.name())
    }

    // Who and where a subscription's pushes go (PushTarget.swift): the
    // bundle ID, and the APNs environment the build was signed for,
    // "sandbox", "production" or "none".
    AsyncFunction("apnsTarget") { () -> [String: String] in
      ["appId": PushTarget.appId(), "environment": PushTarget.environment()]
    }
  }
}
