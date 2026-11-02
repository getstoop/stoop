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

  // Refuses the list's next write, as a keychain that fails partway would.
  function refuseList() {
    const write = vi.mocked(SecureStore.setItemAsync).getMockImplementation();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === "servers") throw new Error("keychain");
      await write?.(key, value);
    });
  }

  it("starts a new server at its first session", async () => {
    const [server] = await saveSignIn([], ORIGIN, "Stoop", "alice", null);
    expect(server.session).toBe(1);
    expect(await sessionToken(server.id)).toBe("alice");
  });

  it("keeps the ID of a saved origin and moves on to the next session", async () => {
    const first = await saveSignIn([], ORIGIN, "Stoop", "alice", null);
    const [second] = await saveSignIn(first, ORIGIN, "Stoop", "bob", "alice");
    expect(second.id).toBe(first[0].id);
    expect(second.session).toBe(2);
    expect(await sessionToken(second.id)).toBe("bob");
  });

  it("counts on from a server saved before sessions were counted", async () => {
    const saved = [{ id: "abcdef", origin: ORIGIN, name: "Stoop" }];
    const [server] = await saveSignIn(saved, ORIGIN, "Stoop", "bob", null);
    expect(server).toMatchObject({ id: "abcdef", session: 1 });
  });

  it("leaves the token in the keychain before the list that reopens the socket", async () => {
    const [server] = await saveSignIn([], ORIGIN, "Stoop", "alice", null);
    expect(writes).toEqual([`session.${server.id}`, "servers"]);
  });

  it("puts the previous token back when the list won't save, and says so", async () => {
    const first = await saveSignIn([], ORIGIN, "Stoop", "alice", null);
    refuseList();
    await expect(saveSignIn(first, ORIGIN, "Stoop", "bob", "alice")).rejects.toThrow("keychain");
    expect(await sessionToken(first[0].id)).toBe("alice");
  });

  it("removes the new token when the list won't save and there was none before", async () => {
    refuseList();
    await expect(saveSignIn([], ORIGIN, "Stoop", "alice", null)).rejects.toThrow("keychain");
    expect([...values.keys()]).toEqual([]);
  });

  it("still reports the list's failure when the token can't be put back", async () => {
    const first = await saveSignIn([], ORIGIN, "Stoop", "alice", null);
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === "servers" || value === "alice") throw new Error(`refused ${key === "servers" ? "list" : "token"}`);
      values.set(key, value);
    });
    await expect(saveSignIn(first, ORIGIN, "Stoop", "bob", "alice")).rejects.toThrow("refused list");
  });

  it("changes nothing when the token itself won't save", async () => {
    const first = await saveSignIn([], ORIGIN, "Stoop", "alice", null);
    vi.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error("keychain"));
    await expect(saveSignIn(first, ORIGIN, "Stoop", "bob", "alice")).rejects.toThrow("keychain");
    expect(await sessionToken(first[0].id)).toBe("alice");
    expect(vi.mocked(SecureStore.deleteItemAsync)).not.toHaveBeenCalled();
  });
});
