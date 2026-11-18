import { describe, expect, it } from "vitest";
import type { NativePushKeys } from "../../modules/stoop-push-keys";
import { PushKeysError, pushKeysOver, validName } from "./keys";

// A native module in memory: keys per ID, made once, and the store's
// text per key. `calls` is every call that reached it.
function fakeNative() {
  const keys = new Map<string, { p256dh: string; auth: string }>();
  const items = new Map<string, string>();
  const calls: string[] = [];
  const native: NativePushKeys = {
    ensureKeys: async (id) => {
      calls.push(`ensureKeys ${id}`);
      const had = keys.get(id);
      if (had) return had;
      const made = { p256dh: `public-${id}-${keys.size}`, auth: `auth-${id}` };
      keys.set(id, made);
      return made;
    },
    publicKey: async (id) => {
      calls.push(`publicKey ${id}`);
      return keys.get(id)?.p256dh ?? null;
    },
    deleteKeys: async (id) => {
      calls.push(`deleteKeys ${id}`);
      keys.delete(id);
    },
    getItem: async (key) => {
      calls.push(`getItem ${key}`);
      return items.get(key) ?? null;
    },
    setItem: async (key, value) => {
      calls.push(`setItem ${key}`);
      items.set(key, value);
    },
    removeItem: async (key) => {
      calls.push(`removeItem ${key}`);
      items.delete(key);
    },
    apnsTarget: async () => ({ appId: "org.getstoop.test", environment: "sandbox" }),
  };
  return { native, items, calls };
}

async function refusedWith(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof PushKeysError) return error.code;
    throw error;
  }
  return "not refused";
}

describe("validName", () => {
  it("takes letters, digits, hyphens and underscores, up to 64", () => {
    expect(validName("a")).toBe(true);
    expect(validName("0195c3b2-7d1e-7a55-9c1f-3f6f0d2b8e11")).toBe(true);
    expect(validName("sub_01HZX")).toBe(true);
    expect(validName("a".repeat(64))).toBe(true);
  });

  it("refuses the empty, the long, and anything a path could use", () => {
    expect(validName("")).toBe(false);
    expect(validName("a".repeat(65))).toBe(false);
    expect(validName("../etc")).toBe(false);
    expect(validName("a/b")).toBe(false);
    expect(validName("a.b")).toBe(false);
    expect(validName("-a")).toBe(false);
    expect(validName("_a")).toBe(false);
    expect(validName("a b")).toBe(false);
    expect(validName("a\n")).toBe(false);
    expect(validName("é")).toBe(false);
  });
});

describe("pushKeysOver", () => {
  it("makes an ID's keys once and reads its public key back", async () => {
    const keys = pushKeysOver(fakeNative().native);
    expect(keys.supported).toBe(true);
    expect(await keys.publicKey("one")).toBeNull();
    const made = await keys.ensure("one");
    expect(await keys.ensure("one")).toEqual(made);
    expect(await keys.publicKey("one")).toBe(made.p256dh);
    expect((await keys.ensure("two")).p256dh).not.toBe(made.p256dh);
  });

  it("forgets an ID's keys", async () => {
    const keys = pushKeysOver(fakeNative().native);
    await keys.ensure("one");
    await keys.remove("one");
    expect(await keys.publicKey("one")).toBeNull();
    await keys.remove("one");
  });

  it("keeps JSON values in the store", async () => {
    const { native, items } = fakeNative();
    const keys = pushKeysOver(native);
    expect(await keys.store.get("servers")).toBeNull();
    await keys.store.set("servers", { a: [1, "two"], b: null });
    expect(items.get("servers")).toBe('{"a":[1,"two"],"b":null}');
    expect(await keys.store.get("servers")).toEqual({ a: [1, "two"], b: null });
    await keys.store.remove("servers");
    expect(await keys.store.get("servers")).toBeNull();
  });

  it("reads a value that is no longer JSON as null", async () => {
    const { native, items } = fakeNative();
    items.set("servers", "{half");
    expect(await pushKeysOver(native).store.get("servers")).toBeNull();
  });

  it("refuses a value JSON cannot hold", async () => {
    const { native, calls } = fakeNative();
    const keys = pushKeysOver(native);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(await refusedWith(keys.store.set("servers", undefined))).toBe("invalid");
    expect(await refusedWith(keys.store.set("servers", circular))).toBe("invalid");
    expect(await refusedWith(keys.store.set("servers", { count: 1n }))).toBe("invalid");
    expect(calls).toEqual([]);
  });

  it("refuses a bad ID or key before the native module hears of it", async () => {
    const { native, calls } = fakeNative();
    const keys = pushKeysOver(native);
    expect(await refusedWith(keys.ensure("../one"))).toBe("invalid");
    expect(await refusedWith(keys.publicKey(""))).toBe("invalid");
    expect(await refusedWith(keys.remove("a b"))).toBe("invalid");
    expect(await refusedWith(keys.store.get("a/b"))).toBe("invalid");
    expect(await refusedWith(keys.store.set("a.b", 1))).toBe("invalid");
    expect(await refusedWith(keys.store.remove("-a"))).toBe("invalid");
    expect(calls).toEqual([]);
  });

  it("says unsupported where there is no native module", async () => {
    const keys = pushKeysOver(null);
    expect(keys.supported).toBe(false);
    expect(await refusedWith(keys.ensure("one"))).toBe("unsupported");
    expect(await refusedWith(keys.publicKey("one"))).toBe("unsupported");
    expect(await refusedWith(keys.remove("one"))).toBe("unsupported");
    expect(await refusedWith(keys.store.get("servers"))).toBe("unsupported");
    expect(await refusedWith(keys.store.set("servers", 1))).toBe("unsupported");
    expect(await refusedWith(keys.store.remove("servers"))).toBe("unsupported");
  });

  it("names what the native module refused", async () => {
    const coded = (code: string) => Object.assign(new Error(`native ${code}`), { code });
    const { native } = fakeNative();
    const keys = pushKeysOver({
      ...native,
      ensureKeys: () => Promise.reject(coded("ERR_PUSH_KEYS_UNAVAILABLE")),
      publicKey: () => Promise.reject(coded("ERR_PUSH_KEYS_INVALID_NAME")),
      deleteKeys: () => Promise.reject(coded("ERR_PUSH_KEYS_FAILED")),
      getItem: () => Promise.reject(new Error("no code")),
      setItem: () => Promise.reject(coded("ERR_PUSH_KEYS_LOCKED")),
    });
    expect(await refusedWith(keys.ensure("one"))).toBe("unavailable");
    expect(await refusedWith(keys.publicKey("one"))).toBe("invalid");
    expect(await refusedWith(keys.remove("one"))).toBe("failed");
    expect(await refusedWith(keys.store.get("servers"))).toBe("failed");
    expect(await refusedWith(keys.store.set("servers", 1))).toBe("locked");
    await expect(keys.ensure("one")).rejects.toThrow("native ERR_PUSH_KEYS_UNAVAILABLE");
  });
});
