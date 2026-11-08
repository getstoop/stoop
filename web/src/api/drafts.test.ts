import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_EXPIRY_MS, type DraftEntry } from "../core/drafts";
import {
  DRAFTS_KEY_PREFIX,
  deleteAllDrafts,
  deleteDraft,
  onDraftChange,
  openDrafts,
  readDraft,
  sweepDrafts,
  writeDraft,
} from "./drafts";

// A Map stands in for localStorage, and a bare window records the storage
// listeners so a test can raise the event another tab would.
const items = new Map<string, string>();
const fakeStorage = {
  get length() {
    return items.size;
  },
  key: (index: number) => [...items.keys()][index] ?? null,
  getItem: (itemKey: string) => items.get(itemKey) ?? null,
  setItem: (itemKey: string, value: string) => void items.set(itemKey, value),
  removeItem: (itemKey: string) => void items.delete(itemKey),
};
type StorageListener = (event: StorageEvent) => void;
const listeners = new Set<StorageListener>();
const fakeWindow = {
  addEventListener: (_type: string, handler: StorageListener) =>
    void listeners.add(handler),
  removeEventListener: (_type: string, handler: StorageListener) =>
    void listeners.delete(handler),
};
const raise = (key: string | null, newValue: string | null) => {
  for (const handler of listeners) handler({ key, newValue } as StorageEvent);
};

const NOW = 1_700_000_000_000;
const entry: DraftEntry = { draft: { text: "hello", writtenAt: NOW } };

beforeEach(() => {
  items.clear();
  listeners.clear();
  vi.stubGlobal("localStorage", fakeStorage);
  vi.stubGlobal("window", fakeWindow);
  openDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readDraft and writeDraft", () => {
  it("reads nothing where nothing was written", () => {
    expect(readDraft("acct/chan/")).toBeUndefined();
  });

  it("round-trips an entry under the prefix", () => {
    writeDraft("acct/chan/", entry);
    expect(readDraft("acct/chan/")).toEqual(entry);
    expect([...items.keys()]).toEqual([`${DRAFTS_KEY_PREFIX}acct/chan/`]);
  });

  it("deletes on an empty entry, and on deleteDraft", () => {
    writeDraft("acct/chan/", entry);
    writeDraft("acct/chan/", undefined);
    expect(items.size).toBe(0);
    writeDraft("acct/chan/", entry);
    deleteDraft("acct/chan/");
    expect(items.size).toBe(0);
  });

  it("reads a malformed item as nothing", () => {
    items.set(`${DRAFTS_KEY_PREFIX}acct/chan/`, "{not json");
    expect(readDraft("acct/chan/")).toBeUndefined();
    items.set(`${DRAFTS_KEY_PREFIX}acct/chan/`, JSON.stringify({ draft: 1 }));
    expect(readDraft("acct/chan/")).toBeUndefined();
  });
});

describe("without storage", () => {
  it("reads as empty and writes nothing when localStorage throws", () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("denied");
      },
      key: () => {
        throw new Error("denied");
      },
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => writeDraft("acct/chan/", entry)).not.toThrow();
    expect(readDraft("acct/chan/")).toBeUndefined();
    expect(() => deleteDraft("acct/chan/")).not.toThrow();
    expect(() => sweepDrafts(NOW)).not.toThrow();
    expect(() => deleteAllDrafts()).not.toThrow();
  });

  it("reads as empty and writes nothing when there is no localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => writeDraft("acct/chan/", entry)).not.toThrow();
    expect(readDraft("acct/chan/")).toBeUndefined();
    expect(() => sweepDrafts(NOW)).not.toThrow();
  });
});

describe("sweepDrafts", () => {
  it("deletes expired and unreadable drafts and keeps the rest", () => {
    writeDraft("live", entry);
    writeDraft("old", {
      draft: { text: "old", writtenAt: NOW - DRAFT_EXPIRY_MS },
    });
    writeDraft("half", {
      draft: { text: "old", writtenAt: NOW - DRAFT_EXPIRY_MS },
      sending: { text: "out", writtenAt: NOW },
    });
    items.set(`${DRAFTS_KEY_PREFIX}broken`, "{not json");
    items.set("stoop.theme", "dusk");
    sweepDrafts(NOW);
    expect([...items.keys()].sort()).toEqual(
      [
        `${DRAFTS_KEY_PREFIX}half`,
        `${DRAFTS_KEY_PREFIX}live`,
        "stoop.theme",
      ].sort(),
    );
  });
});

describe("deleteAllDrafts", () => {
  it("deletes every draft and nothing else", () => {
    writeDraft("acct1/chan/", entry);
    writeDraft("acct2/chan/root", entry);
    items.set("stoop.theme", "dusk");
    deleteAllDrafts();
    expect([...items.keys()]).toEqual(["stoop.theme"]);
  });

  it("closes the store to a late write until it is opened again", () => {
    deleteAllDrafts();
    writeDraft("acct/chan/", entry);
    expect(items.size).toBe(0);
    items.set(`${DRAFTS_KEY_PREFIX}acct/chan/`, JSON.stringify(entry));
    expect(readDraft("acct/chan/")).toBeUndefined();
    deleteDraft("acct/chan/");
    expect(items.size).toBe(1);
    openDrafts();
    expect(readDraft("acct/chan/")).toEqual(entry);
    writeDraft("acct/chan/other", entry);
    expect(items.size).toBe(2);
  });
});

describe("onDraftChange", () => {
  it("hears another tab write or delete the key", () => {
    const heard: (DraftEntry | undefined)[] = [];
    onDraftChange("acct/chan/", (changed) => heard.push(changed));
    raise(`${DRAFTS_KEY_PREFIX}acct/chan/`, JSON.stringify(entry));
    raise(`${DRAFTS_KEY_PREFIX}acct/chan/`, null);
    expect(heard).toEqual([entry, undefined]);
  });

  it("ignores other keys, a cleared store and a closed store", () => {
    const heard: (DraftEntry | undefined)[] = [];
    onDraftChange("acct/chan/", (changed) => heard.push(changed));
    raise(`${DRAFTS_KEY_PREFIX}acct/other/`, JSON.stringify(entry));
    raise("stoop.theme", "dusk");
    raise(null, null);
    deleteAllDrafts();
    raise(`${DRAFTS_KEY_PREFIX}acct/chan/`, JSON.stringify(entry));
    expect(heard).toEqual([]);
  });

  it("stops listening when unsubscribed", () => {
    const heard: (DraftEntry | undefined)[] = [];
    const stop = onDraftChange("acct/chan/", (changed) => heard.push(changed));
    stop();
    raise(`${DRAFTS_KEY_PREFIX}acct/chan/`, JSON.stringify(entry));
    expect(heard).toEqual([]);
    expect(listeners.size).toBe(0);
  });

  it("is a no-op without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => onDraftChange("acct/chan/", () => {})()).not.toThrow();
  });
});
