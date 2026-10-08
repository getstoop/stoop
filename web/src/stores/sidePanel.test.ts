import { afterEach, describe, expect, it, vi } from "vitest";

// The store reads sessionStorage when its module loads, so each case
// stubs the storage first and imports a fresh copy.
async function freshStore(saved: string | null) {
  const storage = new Map<string, string>();
  if (saved !== null) storage.set("stoop.sidePanel", saved);
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  vi.resetModules();
  const module = await import("./sidePanel");
  return { store: module.useSidePanelStore, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("side panel store", () => {
  it("restores a saved panel, so a reload keeps it", async () => {
    const { store } = await freshStore(
      JSON.stringify({ kind: "thread", params: { root: "r1" } }),
    );
    expect(store.getState().open).toEqual({
      kind: "thread",
      params: { root: "r1" },
    });
  });

  it("starts closed on a malformed save", async () => {
    for (const saved of [
      "{",
      '"thread"',
      '{"kind":"thread","params":{"root":7}}',
      '{"params":{}}',
    ]) {
      const { store } = await freshStore(saved);
      expect(store.getState().open, saved).toBeNull();
    }
  });

  it("saves on show and forgets on close", async () => {
    const { store, storage } = await freshStore(null);
    store.getState().show({ kind: "thread", params: { root: "r1" } });
    expect(JSON.parse(storage.get("stoop.sidePanel") ?? "null")).toEqual({
      kind: "thread",
      params: { root: "r1" },
    });
    store.getState().close();
    expect(storage.has("stoop.sidePanel")).toBe(false);
  });
});
