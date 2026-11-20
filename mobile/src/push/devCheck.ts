import * as Notifications from "expo-notifications";
import { pushKeys } from ".";
import { PushKeysError } from "./keys";

// A development build's proof that the push keys work on the phone it
// runs on, as one PUSH_KEYS_CHECK line in Metro's log at launch. Nothing
// in the app uses the keys yet, so this is the only way to see them. It
// is called under __DEV__ alone (src/app/_layout.tsx), so a release
// build has none of it.
//
// It keeps its own keys and its own stored value, both named
// "dev-check":
//   existed   whether the keys were there before this launch: false on
//             the first, true ever after, also after the app is deleted
//             and installed again (the keychain outlives the app)
//   p256dh    the public key, the same on every launch
//   auth      the auth secret: with p256dh, what a push to these keys is
//             encrypted to (scripts/push-apns.mjs sends one by hand).
//             These keys are a development build's own and no server
//             is ever given them
//   authBytes the auth secret's length, 16
//   launches  a count kept in the app group's store: one more each
//             launch, starting over after a reinstall
//
// A second line, PUSH_DEVICE_TOKEN, says Apple's device token for this
// build, which that script sends to.
export async function logPushKeysCheck(): Promise<void> {
  const name = "dev-check";
  try {
    const before = await pushKeys.publicKey(name);
    const keys = await pushKeys.ensure(name);
    const after = await pushKeys.publicKey(name);
    const stored = (await pushKeys.store.get(name)) as { launches?: number } | null;
    const launches = (stored?.launches ?? 0) + 1;
    await pushKeys.store.set(name, { launches });
    const line = {
      existed: before !== null,
      stable: (before === null || before === keys.p256dh) && after === keys.p256dh,
      p256dh: keys.p256dh,
      auth: keys.auth,
      authBytes: Math.floor((keys.auth.length * 3) / 4),
      launches,
    };
    console.info(`PUSH_KEYS_CHECK ${JSON.stringify(line)}`);
  } catch (error) {
    const code = error instanceof PushKeysError ? error.code : "error";
    console.info(`PUSH_KEYS_CHECK ${code}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (pushKeys.supported) console.info(`PUSH_DEVICE_TOKEN ${await deviceToken()}`);
}

// Apple's device token for this build, which a hand-made push is sent
// to, or why there is none. Apple may never answer (no network, a
// simulator that can't register), so it is given a while and no more.
const TOKEN_TIMEOUT_MS = 20000;

async function deviceToken(): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("none: Apple gave no device token"), TOKEN_TIMEOUT_MS);
  });
  try {
    const token = Notifications.getDevicePushTokenAsync().then(({ data }) => String(data));
    return await Promise.race([token, timeout]);
  } catch (error) {
    return `none: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
}
