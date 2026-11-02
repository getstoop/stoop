import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveSignIn, sessionToken } from "./servers";

const store = vi.hoisted(() => ({
  values: new Map<string, string>(),
  writes: [] as string[],
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (key: string) => store.values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    store.values.set(key, value);
    store.writes.push(key);
  },
  deleteItemAsync: async (key: string) => {
    store.values.delete(key);
  },
}));

const ORIGIN = "https://stoop.example";

beforeEach(() => {
  store.values.clear();
  store.writes.length = 0;
});

describe("saveSignIn", () => {
  it("starts a new server at its first session", async () => {
    const [server] = await saveSignIn([], ORIGIN, "Stoop", "alice");
    expect(server.session).toBe(1);
    expect(await sessionToken(server.id)).toBe("alice");
  });

  it("keeps the ID of a saved origin and moves on to the next session", async () => {
    const first = await saveSignIn([], ORIGIN, "Stoop", "alice");
    const [second] = await saveSignIn(first, ORIGIN, "Stoop", "bob");
    expect(second.id).toBe(first[0].id);
    expect(second.session).toBe(2);
    expect(await sessionToken(second.id)).toBe("bob");
  });

  it("counts on from a server saved before sessions were counted", async () => {
    const saved = [{ id: "abcdef", origin: ORIGIN, name: "Stoop" }];
    const [server] = await saveSignIn(saved, ORIGIN, "Stoop", "bob");
    expect(server).toMatchObject({ id: "abcdef", session: 1 });
  });

  it("leaves the token in the keychain before the list that reopens the socket", async () => {
    const [server] = await saveSignIn([], ORIGIN, "Stoop", "alice");
    expect(store.writes).toEqual([`session.${server.id}`, "servers"]);
  });
});
