import { nativePushKeys } from "../../modules/stoop-push-keys";
import { pushKeysOver } from "./keys";

export type { PushSubscriptionKeys } from "../../modules/stoop-push-keys";
export { type PushKeys, PushKeysError, type PushKeysErrorCode } from "./keys";

// This phone's push keys and shared store (keys.ts). Importing it is
// safe everywhere: where there is no native module, `supported` is false
// and every call rejects with a PushKeysError coded "unsupported".
export const pushKeys = pushKeysOver(nativePushKeys);
