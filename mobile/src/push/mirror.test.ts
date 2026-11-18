import { describe, expect, it, vi } from "vitest";
import { MIRROR_KEY, type MirrorFacts, mirrorWriter, nextMirror, parseMirror } from "./mirror";

const facts = (over: Partial<MirrorFacts> = {}): MirrorFacts => ({
  showText: true,
  servers: [{ id: "a", name: "Elm Street" }],
  spaces: () => undefined,
  ...over,
});

describe("parseMirror", () => {
  it("reads a stored mirror back", () => {
    const stored = { showText: false, servers: { a: { name: "Elm Street", spaces: 2 }, b: { name: "Oak" } } };
    expect(parseMirror(stored)).toEqual(stored);
  });

  it("is nothing for what isn't a mirror", () => {
    expect(parseMirror(null)).toBeNull();
    expect(parseMirror("a")).toBeNull();
    expect(parseMirror({})).toBeNull();
    expect(parseMirror({ servers: [] })).toBeNull();
  });

  it("keeps what it can of a partly bad one", () => {
    expect(parseMirror({ showText: "no", servers: { a: { name: "Elm", spaces: "2" }, b: 3, c: { spaces: 1 } } })).toEqual({
      servers: { a: { name: "Elm" } },
    });
  });
});

describe("nextMirror", () => {
  it("says what is known", () => {
    const next = nextMirror(null, facts({ showText: false, spaces: () => 3 }));
    expect(next).toEqual({ showText: false, servers: { a: { name: "Elm Street", spaces: 3 } } });
  });

  it("leaves out what is not known yet and was never mirrored", () => {
    expect(nextMirror(null, facts({ showText: undefined }))).toEqual({ servers: { a: { name: "Elm Street" } } });
  });

  it("keeps what was mirrored before for what is not known yet", () => {
    const previous = { showText: false, servers: { a: { name: "Elm", spaces: 2 } } };
    expect(nextMirror(previous, facts({ showText: undefined }))).toEqual({
      showText: false,
      servers: { a: { name: "Elm Street", spaces: 2 } },
    });
  });

  it("drops a server no longer saved, and takes a new one", () => {
    const previous = { showText: true, servers: { gone: { name: "Gone", spaces: 4 } } };
    expect(nextMirror(previous, facts()).servers).toEqual({ a: { name: "Elm Street" } });
  });
});

// The app group's store in memory.
function fakeStore(initial: unknown = null) {
  let value = initial;
  const set = vi.fn(async (_key: string, next: unknown) => {
    value = next;
  });
  const get = vi.fn(async (_key: string) => value);
  return { get, set, value: () => value };
}

describe("mirrorWriter", () => {
  it("writes the mirror under its key", async () => {
    const store = fakeStore();
    await mirrorWriter(store).update(facts({ spaces: () => 1 }));
    expect(store.set).toHaveBeenCalledWith(MIRROR_KEY, {
      showText: true,
      servers: { a: { name: "Elm Street", spaces: 1 } },
    });
  });

  it("writes nothing when the stored mirror already says it", async () => {
    const store = fakeStore({ showText: true, servers: { a: { name: "Elm Street" } } });
    const writer = mirrorWriter(store);
    await writer.update(facts());
    await writer.update(facts());
    expect(store.set).not.toHaveBeenCalled();
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it("keeps a stored value over one not known yet", async () => {
    const store = fakeStore({ showText: false, servers: { a: { name: "Elm Street", spaces: 5 } } });
    await mirrorWriter(store).update(facts({ showText: undefined }));
    expect(store.set).not.toHaveBeenCalled();
  });

  it("ends on the newest facts when updates overlap", async () => {
    const store = fakeStore();
    const writer = mirrorWriter(store);
    const first = writer.update(facts({ showText: true }));
    const second = writer.update(facts({ showText: false }));
    await Promise.all([first, second]);
    expect(store.value()).toEqual({ showText: false, servers: { a: { name: "Elm Street" } } });
  });

  it("tries again at the next update after the store refused", async () => {
    const store = fakeStore();
    store.set.mockRejectedValueOnce(new Error("locked"));
    const writer = mirrorWriter(store);
    await writer.update(facts());
    expect(store.value()).toBeNull();
    await writer.update(facts());
    expect(store.value()).toEqual({ showText: true, servers: { a: { name: "Elm Street" } } });
  });
});
