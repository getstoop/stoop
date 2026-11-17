import type { NativePushKeys, PushSubscriptionKeys } from "../../modules/stoop-push-keys";

// The phone's side of encrypted push, over the native module
// (modules/stoop-push-keys): the keys a subscription's pushes are
// encrypted to, and a small store the notification service extension
// reads. iOS only so far.
//
// Keys are per ID, which is the caller's to choose (a subscription's);
// here it is only a short name. An ID has keys when the keychain holds
// them, and the keychain outlives the app: after the app is deleted and
// installed again, `ensure` for an ID it had before answers with the
// same keys. The app group's store does not outlive the app.

// Why a call was refused:
//   unsupported  no native module (Android, or a build from before it)
//   unavailable  the build has no app group (signed without one)
//   invalid      not an ID or key this takes, or a value JSON can't hold
//   failed       the keychain or the file system refused
export type PushKeysErrorCode = "unsupported" | "unavailable" | "invalid" | "failed";

export class PushKeysError extends Error {
  readonly code: PushKeysErrorCode;

  constructor(code: PushKeysErrorCode, message: string) {
    super(message);
    this.name = "PushKeysError";
    this.code = code;
  }
}

export type PushKeys = {
  // False where every call below rejects as "unsupported".
  supported: boolean;
  // The ID's keys, made if it has none.
  ensure(id: string): Promise<PushSubscriptionKeys>;
  // The ID's public key (p256dh), or null when it has no keys.
  publicKey(id: string): Promise<string | null>;
  // Forgets the ID's keys; nothing to forget is not an error.
  remove(id: string): Promise<void>;
  // The app group's store, a JSON value per key. A value that is not
  // JSON any more reads as null.
  store: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
};

// What the native side takes for an ID or a key (PushGroup.swift checks
// the same): it becomes a keychain account or a file's name.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function validName(name: string): boolean {
  return NAME.test(name);
}

const NATIVE_CODES: Record<string, PushKeysErrorCode> = {
  ERR_PUSH_KEYS_UNAVAILABLE: "unavailable",
  ERR_PUSH_KEYS_INVALID_NAME: "invalid",
};

function refusal(error: unknown): PushKeysError {
  if (error instanceof PushKeysError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return new PushKeysError((typeof code === "string" && NATIVE_CODES[code]) || "failed", message);
}

export function pushKeysOver(native: NativePushKeys | null): PushKeys {
  // One call to the native module, after its name is checked, with
  // whatever it rejects with turned into a PushKeysError.
  async function call<Result>(name: string, run: (native: NativePushKeys) => Promise<Result>): Promise<Result> {
    if (!native) throw new PushKeysError("unsupported", "Push keys are not supported on this platform");
    if (!validName(name)) throw new PushKeysError("invalid", `Not a valid ID or key: '${name}'`);
    try {
      return await run(native);
    } catch (error) {
      throw refusal(error);
    }
  }

  return {
    supported: native !== null,
    ensure: (id) => call(id, (module) => module.ensureKeys(id)),
    publicKey: (id) => call(id, (module) => module.publicKey(id)),
    remove: (id) => call(id, (module) => module.deleteKeys(id)),
    store: {
      get: (key) =>
        call(key, async (module) => {
          const text = await module.getItem(key);
          if (text === null) return null;
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return null;
          }
        }),
      set: (key, value) =>
        call(key, (module) => {
          const text = JSON.stringify(value);
          if (text === undefined) throw new PushKeysError("invalid", `Not a JSON value for '${key}'`);
          return module.setItem(key, text);
        }),
      remove: (key) => call(key, (module) => module.removeItem(key)),
    },
  };
}
