import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { nativePushKeys } from "../../modules/stoop-push-keys";
import { type PushRecord, parseRecord } from "./record";
import type { PushTargetInfo } from "./subscriber";

// What the subscriber (subscriber.ts) is given from the phone itself.

// The relay set at build time (STOOP_PUSH_RELAY_URL, app.config.js), or
// null: then the app registers for no push at all.
export function relayUrl(): string | null {
  const url = (Constants.expoConfig?.extra as { pushRelayUrl?: unknown } | undefined)?.pushRelayUrl;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

// Push is iOS only for now: elsewhere there is no native module.
export const pushSupported = Platform.OS === "ios" && nativePushKeys !== null;

export async function notificationsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

// The APNs device token (not an Expo push token), hex. Apple answers
// through the app's delegate, and may never answer (no network, a
// simulator that can't register), so it is given a while and no more.
const TOKEN_TIMEOUT_MS = 20000;

export async function apnsDeviceToken(): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Apple gave no device token")), TOKEN_TIMEOUT_MS);
  });
  try {
    const token = await Promise.race([Notifications.getDevicePushTokenAsync(), timeout]);
    if (typeof token.data !== "string" || token.data === "") throw new Error("no device token");
    return token.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function apnsTarget(): Promise<PushTargetInfo> {
  if (!nativePushKeys) return { appId: "", environment: null };
  const target = await nativePushKeys.apnsTarget();
  return { appId: target.appId, environment: target.environment === "none" ? null : target.environment };
}

// Each server's record in the keychain beside its session token
// (api/servers.ts), with the same device-only class: the app's own
// store for what it keeps per server.
const recordKey = (id: string) => `push.${id}`;
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const pushRecords = {
  get: async (id: string): Promise<PushRecord | null> => parseRecord(await SecureStore.getItemAsync(recordKey(id), OPTIONS)),
  set: (id: string, record: PushRecord) => SecureStore.setItemAsync(recordKey(id), JSON.stringify(record), OPTIONS),
  remove: (id: string) => SecureStore.deleteItemAsync(recordKey(id), OPTIONS),
};
