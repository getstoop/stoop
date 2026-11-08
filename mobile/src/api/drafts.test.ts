import { DRAFT_EXPIRY_MS, type DraftEntry } from "@stoop/core/drafts";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The draft store over a file system held in memory: a map of file uri to
// content, with folders implied by the files under them, as the real one
// lists them. `refusing` makes every read, write and listing throw.

const disk = new Map<string, string>();
let refusing = false;
// Only a folder's delete refuses, as when a file in it is held open.
let refusingFolderDelete = false;
const refuse = () => {
  if (refusing) throw new Error("the disk refused");
};
const join = (parts: (string | { uri: string })[]) =>
  parts
    .map((part) => (typeof part === "string" ? part : part.uri))
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
const basename = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

vi.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get name() {
      return basename(this.uri);
    }
    get exists() {
      refuse();
      return [...disk.keys()].some((path) => path.startsWith(`${this.uri}/`));
    }
    create() {
      refuse();
    }
    delete() {
      refuse();
      if (refusingFolderDelete) throw new Error("the folder refused");
      for (const path of [...disk.keys()]) if (path.startsWith(`${this.uri}/`)) disk.delete(path);
    }
    list(): (Directory | File)[] {
      refuse();
      const children = new Map<string, boolean>();
      for (const path of disk.keys()) {
        if (!path.startsWith(`${this.uri}/`)) continue;
        const rest = path.slice(this.uri.length + 1);
        const slash = rest.indexOf("/");
        children.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...children].map(([name, isDirectory]) =>
        isDirectory ? new Directory(this.uri, name) : new File(this.uri, name),
      );
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get name() {
      return basename(this.uri);
    }
    get parentDirectory() {
      return new Directory(this.uri.slice(0, this.uri.lastIndexOf("/")));
    }
    get exists() {
      refuse();
      return disk.has(this.uri);
    }
    textSync() {
      refuse();
      const text = disk.get(this.uri);
      if (text === undefined) throw new Error("no such file");
      return text;
    }
    writeSync(text: string) {
      refuse();
      disk.set(this.uri, text);
    }
    delete() {
      refuse();
      disk.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { document: { uri: "documents" } } };
});

const NOW = 1_700_000_000_000;
const SERVER = "abc123";
const OTHER_SERVER = "zyx987";
const ACCOUNT = "0190a5c4-0000-7000-8000-000000000001";
const OTHER_ACCOUNT = "0190a5c4-0000-7000-8000-000000000002";
const CHANNEL = "0190a5c4-0000-7000-8000-00000000000c";
const ROOT = "0190a5c4-0000-7000-8000-00000000000d";
const at = (serverId: string, accountId: string) => `documents/drafts/${serverId}/${accountId}.json`;
const address = { serverId: SERVER, accountId: ACCOUNT, channelId: CHANNEL };
const entry = (text: string, writtenAt = NOW): DraftEntry => ({ draft: { text, writtenAt } });

// A fresh module per test: the store holds what it has read.
beforeEach(() => {
  disk.clear();
  refusing = false;
  refusingFolderDelete = false;
  vi.resetModules();
});

async function freshStore() {
  const store = await import("./drafts");
  store.rememberSavedServers([SERVER]);
  return store;
}

describe("readDraft, writeDraft and deleteDraft", () => {
  it("reads nothing where nothing was written", async () => {
    const store = await freshStore();
    expect(store.readDraft(address)).toBeUndefined();
    expect(disk.size).toBe(0);
  });

  it("round-trips an entry through the account's file", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("hello"));
    expect(store.readDraft(address)).toEqual(entry("hello"));
    expect([...disk.keys()]).toEqual([at(SERVER, ACCOUNT)]);
    expect(JSON.parse(disk.get(at(SERVER, ACCOUNT)) as string)).toEqual({
      [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("hello"),
    });
  });

  it("keeps a thread's draft apart from the channel's", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("channel"));
    store.writeDraft({ ...address, threadRootId: ROOT }, entry("thread"));
    expect(store.readDraft(address)).toEqual(entry("channel"));
    expect(store.readDraft({ ...address, threadRootId: ROOT })).toEqual(entry("thread"));
    expect(disk.size).toBe(1);
  });

  it("keeps each account's drafts in its own file", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("mine"));
    store.writeDraft({ ...address, accountId: OTHER_ACCOUNT }, entry("theirs"));
    expect(disk.has(at(SERVER, ACCOUNT))).toBe(true);
    expect(disk.has(at(SERVER, OTHER_ACCOUNT))).toBe(true);
    expect(store.readDraft(address)).toEqual(entry("mine"));
  });

  it("reads what an earlier run wrote", async () => {
    const before = await freshStore();
    before.writeDraft(address, entry("kept"));
    vi.resetModules();
    const after = await freshStore();
    expect(after.readDraft(address)).toEqual(entry("kept"));
  });

  it("deletes an entry, and the file with its last one", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("one"));
    store.writeDraft({ ...address, threadRootId: ROOT }, entry("two"));
    store.deleteDraft(address);
    expect(store.readDraft(address)).toBeUndefined();
    expect(disk.has(at(SERVER, ACCOUNT))).toBe(true);
    store.writeDraft({ ...address, threadRootId: ROOT }, undefined);
    expect(disk.has(at(SERVER, ACCOUNT))).toBe(false);
  });

  it("refuses an account ID that is not a plain word", async () => {
    const store = await freshStore();
    store.writeDraft({ ...address, accountId: "../escape" }, entry("no"));
    expect(disk.size).toBe(0);
    expect(store.readDraft({ ...address, accountId: "../escape" })).toBeUndefined();
  });
});

describe("the saved servers", () => {
  it("knows of no server until told: reads empty, writes nothing", async () => {
    disk.set(at(SERVER, ACCOUNT), JSON.stringify({ [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("unseen") }));
    const store = await import("./drafts");
    expect(store.readDraft(address)).toBeUndefined();
    store.writeDraft(address, entry("stray"));
    expect(JSON.parse(disk.get(at(SERVER, ACCOUNT)) as string)).toEqual({
      [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("unseen"),
    });
  });

  it("takes writes for a server newly saved", async () => {
    const store = await freshStore();
    store.writeDraft({ ...address, serverId: OTHER_SERVER }, entry("too soon"));
    expect(disk.size).toBe(0);
    store.rememberSavedServers([SERVER, OTHER_SERVER]);
    store.writeDraft({ ...address, serverId: OTHER_SERVER }, entry("in time"));
    expect(store.readDraft({ ...address, serverId: OTHER_SERVER })).toEqual(entry("in time"));
  });

  it("refuses a write for a server that is not saved", async () => {
    const store = await freshStore();
    store.writeDraft({ ...address, serverId: OTHER_SERVER }, entry("stray"));
    expect(disk.size).toBe(0);
  });

  it("refuses a write after the server is forgotten", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("before"));
    store.rememberSavedServers([]);
    store.writeDraft(address, entry("after"));
    expect(store.readDraft(address)).toBeUndefined();
    expect(JSON.parse(disk.get(at(SERVER, ACCOUNT)) as string)).toEqual({
      [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("before"),
    });
  });

  it("deleteServerDrafts drops every account's file and refuses writes from then on", async () => {
    const store = await freshStore();
    store.rememberSavedServers([SERVER, OTHER_SERVER]);
    store.writeDraft(address, entry("mine"));
    store.writeDraft({ ...address, accountId: OTHER_ACCOUNT }, entry("theirs"));
    store.writeDraft({ ...address, serverId: OTHER_SERVER }, entry("elsewhere"));
    // A caller that didn't forget the server first.
    store.deleteServerDrafts(SERVER);
    expect([...disk.keys()]).toEqual([at(OTHER_SERVER, ACCOUNT)]);
    store.writeDraft(address, entry("late"));
    expect(store.readDraft(address)).toBeUndefined();
    expect([...disk.keys()]).toEqual([at(OTHER_SERVER, ACCOUNT)]);
    expect(store.readDraft({ ...address, serverId: OTHER_SERVER })).toEqual(entry("elsewhere"));
  });

  it("deleteServerDrafts with a folder that won't go still forgets it and refuses writes", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("held"));
    refusingFolderDelete = true;
    expect(() => store.deleteServerDrafts(SERVER)).not.toThrow();
    refusingFolderDelete = false;
    store.writeDraft(address, entry("late"));
    expect(store.readDraft(address)).toBeUndefined();
    // Saved again under the same ID (not how the app works, but it shows
    // nothing is still held): what is there comes from the disk.
    store.rememberSavedServers([SERVER]);
    expect(store.readDraft(address)).toEqual(entry("held"));
  });
});

describe("sweepDrafts", () => {
  it("drops expired entries and a file left with none", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("stale", NOW - DRAFT_EXPIRY_MS));
    store.writeDraft({ ...address, threadRootId: ROOT }, entry("fresh", NOW - DRAFT_EXPIRY_MS + 1));
    store.writeDraft({ ...address, accountId: OTHER_ACCOUNT }, entry("gone", NOW - DRAFT_EXPIRY_MS - 1));
    store.sweepDrafts(NOW);
    expect(store.readDraft(address)).toBeUndefined();
    expect(store.readDraft({ ...address, threadRootId: ROOT })).toEqual(entry("fresh", NOW - DRAFT_EXPIRY_MS + 1));
    expect([...disk.keys()]).toEqual([at(SERVER, ACCOUNT)]);
  });

  it("keeps a sending slot younger than the expiry", async () => {
    const store = await freshStore();
    const sending: DraftEntry = { sending: { text: "out", writtenAt: NOW - 1 } };
    store.writeDraft(address, sending);
    store.sweepDrafts(NOW);
    expect(store.readDraft(address)).toEqual(sending);
  });

  it("drops a forgotten server's folder whole", async () => {
    const store = await freshStore();
    store.rememberSavedServers([SERVER, OTHER_SERVER]);
    store.writeDraft(address, entry("kept"));
    store.writeDraft({ ...address, serverId: OTHER_SERVER }, entry("orphan"));
    store.writeDraft({ ...address, serverId: OTHER_SERVER, accountId: OTHER_ACCOUNT }, entry("orphan too"));
    store.rememberSavedServers([SERVER]);
    store.sweepDrafts(NOW);
    expect([...disk.keys()]).toEqual([at(SERVER, ACCOUNT)]);
    // Nothing of the folder is still held: saved again, it reads from the (empty) disk.
    store.rememberSavedServers([SERVER, OTHER_SERVER]);
    expect(store.readDraft({ ...address, serverId: OTHER_SERVER })).toBeUndefined();
  });

  it("drops a file that is not what was written", async () => {
    disk.set(at(SERVER, ACCOUNT), "not json");
    disk.set(at(SERVER, OTHER_ACCOUNT), JSON.stringify({ key: { draft: { text: 1 } } }));
    const store = await freshStore();
    store.sweepDrafts(NOW);
    expect(disk.size).toBe(0);
  });

  it("does nothing where nothing was ever kept", async () => {
    const store = await freshStore();
    expect(() => store.sweepDrafts(NOW)).not.toThrow();
    expect(disk.size).toBe(0);
  });
});

describe("a file that is not what was written", () => {
  it("reads as empty and the next write replaces it", async () => {
    disk.set(at(SERVER, ACCOUNT), "{not json");
    const store = await freshStore();
    expect(store.readDraft(address)).toBeUndefined();
    store.writeDraft(address, entry("new"));
    expect(store.readDraft(address)).toEqual(entry("new"));
    expect(JSON.parse(disk.get(at(SERVER, ACCOUNT)) as string)).toEqual({
      [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("new"),
    });
  });

  it("keeps the entries that are drafts and drops the rest", async () => {
    disk.set(
      at(SERVER, ACCOUNT),
      JSON.stringify({
        [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("good"),
        [`${SERVER}/${ACCOUNT}/${CHANNEL}/${ROOT}`]: { draft: { text: "no time" } },
        junk: 42,
      }),
    );
    const store = await freshStore();
    expect(store.readDraft(address)).toEqual(entry("good"));
    expect(store.readDraft({ ...address, threadRootId: ROOT })).toBeUndefined();
  });
});

describe("a disk that refuses", () => {
  it("reads as empty, takes no writes, and says nothing", async () => {
    disk.set(at(SERVER, ACCOUNT), JSON.stringify({ [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("unseen") }));
    refusing = true;
    const store = await freshStore();
    expect(store.readDraft(address)).toBeUndefined();
    expect(() => store.writeDraft(address, entry("lost"))).not.toThrow();
    expect(() => store.deleteDraft(address)).not.toThrow();
    expect(() => store.sweepDrafts(NOW)).not.toThrow();
    expect(() => store.deleteServerDrafts(SERVER)).not.toThrow();
    refusing = false;
    // The file it couldn't read was never overwritten.
    expect(JSON.parse(disk.get(at(SERVER, ACCOUNT)) as string)).toEqual({
      [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("unseen"),
    });
  });

  it("reads again once the disk answers, and then takes writes", async () => {
    disk.set(at(SERVER, ACCOUNT), JSON.stringify({ [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("kept") }));
    refusing = true;
    const store = await freshStore();
    store.sweepDrafts(NOW);
    expect(store.readDraft(address)).toBeUndefined();
    store.writeDraft({ ...address, threadRootId: ROOT }, entry("lost"));
    refusing = false;
    expect(store.readDraft(address)).toEqual(entry("kept"));
    store.writeDraft({ ...address, threadRootId: ROOT }, entry("later"));
    expect(store.readDraft({ ...address, threadRootId: ROOT })).toEqual(entry("later"));
    expect(JSON.parse(disk.get(at(SERVER, ACCOUNT)) as string)).toEqual({
      [`${SERVER}/${ACCOUNT}/${CHANNEL}/`]: entry("kept"),
      [`${SERVER}/${ACCOUNT}/${CHANNEL}/${ROOT}`]: entry("later"),
    });
  });

  it("drops a write the disk refuses and keeps what was there", async () => {
    const store = await freshStore();
    store.writeDraft(address, entry("first"));
    refusing = true;
    store.writeDraft(address, entry("second"));
    refusing = false;
    expect(store.readDraft(address)).toEqual(entry("first"));
  });
});
