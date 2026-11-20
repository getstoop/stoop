import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";
import type { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { pushClient } from "./clients";

// One session's push subscription on its server (PushService). Keys are
// base64url without padding on this side, as the native module and the
// relay have them, and bytes on the wire.

const TIMEOUT_MS = 10000;

export type PushConfig = { enabled: boolean; serverKey: string };

export type PushRegistration = {
  endpoint: string;
  p256dh: string;
  auth: string;
  localServerId: string;
  kinds: ActivityKind[];
};

export async function getPushConfig(origin: string, token: string): Promise<PushConfig> {
  const answer = await pushClient(origin, token).getPushConfig({}, { timeoutMs: TIMEOUT_MS });
  return { enabled: answer.enabled, serverKey: base64Encode(answer.applicationServerKey, "url") };
}

export async function registerPush(origin: string, token: string, registration: PushRegistration): Promise<void> {
  await pushClient(origin, token).registerPushSubscription(
    {
      endpoint: registration.endpoint,
      p256dh: base64Decode(registration.p256dh),
      auth: base64Decode(registration.auth),
      localServerId: registration.localServerId,
      kinds: registration.kinds,
    },
    { timeoutMs: TIMEOUT_MS },
  );
}

// Rejects NotFound when the session has no subscription.
export async function updatePush(origin: string, token: string, kinds: ActivityKind[]): Promise<void> {
  await pushClient(origin, token).updatePushSubscription({ kinds }, { timeoutMs: TIMEOUT_MS });
}

// Short, as signing out's own call (servers/endSession.ts): the session's
// end waits on it.
const DELETE_TIMEOUT_MS = 5000;

export async function deletePush(origin: string, token: string): Promise<void> {
  await pushClient(origin, token).deletePushSubscription({}, { timeoutMs: DELETE_TIMEOUT_MS });
}
