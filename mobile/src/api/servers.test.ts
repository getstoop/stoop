import * as SecureStore from "expo-secure-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadServers } from "./servers";

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
