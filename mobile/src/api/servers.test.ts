import * as SecureStore from "expo-secure-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadServers, saveSignIn, sessionToken } from "./servers";

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const stored = vi.mocked(SecureStore.getItemAsync);
const ONE = { id: "aaaaaa", origin: "https://one.example", name: "One" };

describe("loadServers", () => {
  beforeEach(() => {
    stored.mockReset();
  });

  it("rejects when the keychain refuses the read", async () => {
    stored.mockRejectedValue(new Error("locked"));
    await expect(loadServers()).rejects.toThrow("locked");
  });

  it("reads nothing stored as empty", async () => {
    stored.mockResolvedValue(null);
    expect(await loadServers()).toEqual([]);
  });

  it("reads the stored list", async () => {
    stored.mockResolvedValue(JSON.stringify([ONE]));
    expect(await loadServers()).toEqual([ONE]);
  });

  it.each(["not json", "{}", "[null]"])("reads %s as empty, which no retry could change", async (raw) => {
    stored.mockResolvedValue(raw);
    expect(await loadServers()).toEqual([]);
  });
});

describe("saveSignIn", () => {
  const ORIGIN = "https://stoop.example";
  const values = new Map<string, string>();
  const writes: string[] = [];

  beforeEach(() => {
    values.clear();
    writes.length = 0;
    stored.mockReset();
    stored.mockImplementation(async (key) => values.get(key) ?? null);
    vi.mocked(SecureStore.setItemAsync).mockReset();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      values.set(key, value);
      writes.push(key);
    });
    vi.mocked(SecureStore.deleteItemAsync).mockReset();
    vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
      values.delete(key);
    });
  });

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
    expect(writes).toEqual([`session.${server.id}`, "servers"]);
  });
});
