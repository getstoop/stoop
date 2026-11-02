import * as SecureStore from "expo-secure-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearFileCaches } from "../api/downloads";
import { sessionToken } from "../api/servers";
import { endSession } from "./endSession";
import { keepSignIn } from "./keepSignIn";
import { serverList } from "./serverList";

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("../api/downloads", () => ({ clearFileCaches: vi.fn(async () => {}) }));
vi.mock("./endSession", () => ({ endSession: vi.fn() }));

const ORIGIN = "https://stoop.example";
const values = new Map<string, string>();

async function started() {
  const list = serverList(
    async () => [],
    () => {},
  );
  await list.read();
  return list.change;
}

beforeEach(() => {
  vi.clearAllMocks();
  values.clear();
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) ?? null);
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    values.delete(key);
  });
});

describe("keepSignIn", () => {
  it("has nothing to end or forget for a server new here", async () => {
    const change = await started();
    const id = await keepSignIn(change, ORIGIN, "Stoop", "alice");
    expect(await sessionToken(id)).toBe("alice");
    expect(endSession).not.toHaveBeenCalled();
    expect(clearFileCaches).not.toHaveBeenCalled();
  });

  it("ends the old session by its own token, keeps the ID, and forgets the files", async () => {
    const change = await started();
    const id = await keepSignIn(change, ORIGIN, "Stoop", "alice");
    expect(await keepSignIn(change, ORIGIN, "Stoop", "bob")).toBe(id);
    expect(await sessionToken(id)).toBe("bob");
    expect(vi.mocked(endSession).mock.calls).toEqual([[ORIGIN, "alice"]]);
    expect(clearFileCaches).toHaveBeenCalledOnce();
  });

  it("ends nothing until the new session is saved", async () => {
    const change = await started();
    const id = await keepSignIn(change, ORIGIN, "Stoop", "alice");
    let tokenWhenEnded: string | undefined;
    vi.mocked(endSession).mockImplementation(() => {
      tokenWhenEnded = values.get(`session.${id}`);
    });
    await keepSignIn(change, ORIGIN, "Stoop", "bob");
    expect(tokenWhenEnded).toBe("bob");
  });

  it("gives each of two overlapping sign-ins the token the one before it left", async () => {
    const change = await started();
    const id = await keepSignIn(change, ORIGIN, "Stoop", "alice");
    await Promise.all([
      keepSignIn(change, ORIGIN, "Stoop", "bob"),
      keepSignIn(change, ORIGIN, "Stoop", "carol"),
    ]);
    expect(vi.mocked(endSession).mock.calls.map(([, token]) => token)).toEqual(["alice", "bob"]);
    expect(await sessionToken(id)).toBe("carol");
  });

  it("when the list won't save, keeps the old session, ending nothing, and fails", async () => {
    const change = await started();
    const id = await keepSignIn(change, ORIGIN, "Stoop", "alice");
    vi.mocked(clearFileCaches).mockClear();
    vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
      if (key === "servers") throw new Error("keychain");
      values.set(key, value);
    });
    await expect(keepSignIn(change, ORIGIN, "Stoop", "bob")).rejects.toThrow("keychain");
    expect(await sessionToken(id)).toBe("alice");
    expect(endSession).not.toHaveBeenCalled();
    expect(clearFileCaches).not.toHaveBeenCalled();
  });
});
