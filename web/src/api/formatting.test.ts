import { afterEach, describe, expect, it, vi } from "vitest";
import { IS_MAC, shortcutFormat, shortcutHint } from "./formatting";

describe("shortcutFormat", () => {
  const press = (
    key: string,
    mods: Partial<{
      metaKey: boolean;
      ctrlKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
    }> = {},
  ) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it.each([
    ["b", "bold"],
    ["i", "italic"],
    ["u", "underline"],
    ["e", "code"],
  ] as const)("maps %s to %s", (key, format) => {
    expect(shortcutFormat(press(key, { metaKey: true }))).toBe(format);
  });

  it("maps Shift+X to strike", () => {
    expect(shortcutFormat(press("x", { metaKey: true, shiftKey: true }))).toBe(
      "strike",
    );
  });

  // The browser reports an uppercase key while Shift is down.
  it("ignores the case of the key", () => {
    expect(shortcutFormat(press("B", { ctrlKey: true }))).toBe("bold");
    expect(shortcutFormat(press("X", { ctrlKey: true, shiftKey: true }))).toBe(
      "strike",
    );
  });

  it("takes either modifier, on any platform", () => {
    expect(shortcutFormat(press("b", { ctrlKey: true }))).toBe("bold");
    expect(shortcutFormat(press("b", { metaKey: true }))).toBe("bold");
    expect(shortcutFormat(press("b", { metaKey: true, ctrlKey: true }))).toBe(
      "bold",
    );
  });

  it("gives nothing for a bare key", () => {
    expect(shortcutFormat(press("b"))).toBeNull();
  });

  it("gives nothing when Alt is held", () => {
    expect(
      shortcutFormat(press("b", { metaKey: true, altKey: true })),
    ).toBeNull();
  });

  it("gives nothing for an unmapped key", () => {
    expect(shortcutFormat(press("k", { metaKey: true }))).toBeNull();
    expect(shortcutFormat(press("Enter", { metaKey: true }))).toBeNull();
  });

  it("gives nothing for Shift plus a key that is not X", () => {
    expect(
      shortcutFormat(press("b", { metaKey: true, shiftKey: true })),
    ).toBeNull();
  });
});

describe("shortcutHint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // IS_MAC is read once at module load, so each platform needs a fresh
  // import.
  const loadFor = async (platform: string | null) => {
    vi.resetModules();
    vi.stubGlobal("navigator", platform === null ? undefined : { platform });
    return await import("./formatting");
  };

  it("names the command key on a Mac", async () => {
    const m = await loadFor("MacIntel");
    expect(m.IS_MAC).toBe(true);
    expect(m.shortcutHint("B")).toBe("⌘B");
    expect(m.shortcutHint("Shift+X")).toBe("⌘Shift+X");
  });

  it("names Ctrl everywhere else", async () => {
    const m = await loadFor("Linux x86_64");
    expect(m.IS_MAC).toBe(false);
    expect(m.shortcutHint("B")).toBe("Ctrl+B");
  });

  it("counts an iPad as a Mac", async () => {
    expect((await loadFor("iPad")).IS_MAC).toBe(true);
  });

  it("falls back to Ctrl with no navigator at all", async () => {
    const m = await loadFor(null);
    expect(m.IS_MAC).toBe(false);
    expect(m.shortcutHint("B")).toBe("Ctrl+B");
  });

  it("agrees with the module already imported here", () => {
    expect(shortcutHint("B")).toBe(IS_MAC ? "⌘B" : "Ctrl+B");
  });
});
