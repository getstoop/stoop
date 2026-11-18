import { requireOptionalNativeModule } from "expo";

// A Web Push subscription's public half (RFC 8291), both base64url
// without padding: the P-256 public key as a 65-byte uncompressed point,
// and the 16-byte auth secret. The private key stays in the keychain.
export type PushSubscriptionKeys = { p256dh: string; auth: string };

// StoopPushKeysModule.swift. An ID or a key is 1 to 64 letters, digits,
// "-" and "_", starting with a letter or digit. A call rejects with an
// error whose `code` is ERR_PUSH_KEYS_UNAVAILABLE (the build has no app
// group), ERR_PUSH_KEYS_INVALID_NAME, ERR_PUSH_KEYS_LOCKED (the phone has
// not been unlocked since it started) or ERR_PUSH_KEYS_FAILED.
export type NativePushKeys = {
  ensureKeys(id: string): Promise<PushSubscriptionKeys>;
  publicKey(id: string): Promise<string | null>;
  deleteKeys(id: string): Promise<void>;
  // The app group's store: a value is JSON text.
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  // The bundle ID, and the APNs environment the build was signed for:
  // read from its provisioning profile, production with none (the App
  // Store, TestFlight), sandbox on the simulator, "none" when the
  // profile grants no push. Never rejects.
  apnsTarget(): Promise<{ appId: string; environment: "sandbox" | "production" | "none" }>;
};

// The module is built for iOS only (expo-module.config.json); on
// Android, and in a build made before it was added, this is null.
// The app uses it through src/push/keys.ts.
export const nativePushKeys = requireOptionalNativeModule<NativePushKeys>("StoopPushKeys");
