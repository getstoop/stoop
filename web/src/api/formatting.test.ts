import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFormat,
  type Format,
  IS_MAC,
  shortcutFormat,
  shortcutHint,
} from "./formatting";

// The inline formats and the marker each one writes.
const MARKERS: [
  Exclude<Format, "quote" | "list" | "orderedList" | "codeblock">,
  string,
][] = [
  ["bold", "**"],
  ["italic", "*"],
  ["underline", "__"],
  ["strike", "~~"],
  ["code", "`"],
  ["spoiler", "||"],
];

describe("applyFormat: inline markers", () => {
  it.each(MARKERS)("%s wraps the selection in %s", (format, m) => {
    expect(applyFormat("casey", 0, 5, format)).toEqual({
      value: `${m}casey${m}`,
      start: m.length,
      end: 5 + m.length,
    });
  });

  it("leaves the inner text selected, not the markers", () => {
    const { value, start, end } = applyFormat("hi there", 0, 8, "bold");
    expect(value.slice(start, end)).toBe("hi there");
    expect([start, end]).toEqual([2, 10]);
  });

  it("touches only the selection, not the rest of the line", () => {
    expect(applyFormat("say hi there", 4, 6, "bold")).toEqual({
      value: "say **hi** there",
      start: 6,
      end: 8,
    });
  });

  it("nests around text that is already formatted", () => {
    expect(applyFormat("*hi there*", 0, 10, "strike")).toEqual({
      value: "~~*hi there*~~",
      start: 2,
      end: 12,
    });
  });
});

describe("applyFormat: unwrapping", () => {
  it("removes markers that hug the selection", () => {
    expect(applyFormat("**hi there**", 2, 10, "bold")).toEqual({
      value: "hi there",
      start: 0,
      end: 8,
    });
  });

  it("removes them mid-line and keeps the words selected", () => {
    expect(applyFormat("say **hi** there", 6, 8, "bold")).toEqual({
      value: "say hi there",
      start: 4,
      end: 6,
    });
  });

  it("strips markers the selection includes", () => {
    expect(applyFormat("**hi there**", 0, 12, "bold")).toEqual({
      value: "hi there",
      start: 0,
      end: 8,
    });
  });

  it.each(MARKERS)("unwraps %s too", (format, m) => {
    expect(applyFormat(`${m}casey${m}`, 0, 5 + 2 * m.length, format)).toEqual({
      value: "casey",
      start: 0,
      end: 5,
    });
  });

  // Italic finds an asterisk on each side of the selection and takes it
  // as its own, so italicising the inside of **bold** demotes the bold.
  it("takes one marker off each side even when it belongs to a wider pair", () => {
    expect(applyFormat("**casey**", 2, 7, "italic")).toEqual({
      value: "*casey*",
      start: 1,
      end: 6,
    });
  });
});

describe("applyFormat: caret only", () => {
  it.each(MARKERS)(
    "%s opens an empty pair with the caret inside",
    (format, m) => {
      const { value, start, end } = applyFormat("say ", 4, 4, format);
      expect(value).toBe(`say ${m}${m}`);
      expect([start, end]).toEqual([4 + m.length, 4 + m.length]);
      // What you type next lands between the markers.
      expect(`${value.slice(0, start)}loud${value.slice(start)}`).toBe(
        `say ${m}loud${m}`,
      );
    },
  );

  it("removes the pair again when the caret is still inside it", () => {
    expect(applyFormat("say ****", 6, 6, "bold")).toEqual({
      value: "say ",
      start: 4,
      end: 4,
    });
  });

  it("steps past the closer rather than opening a second pair", () => {
    expect(applyFormat("say **loud**", 10, 10, "bold")).toEqual({
      value: "say **loud**",
      start: 12,
      end: 12,
    });
  });

  it("steps past a one-character closer as well", () => {
    expect(applyFormat("*it*", 3, 3, "italic")).toEqual({
      value: "*it*",
      start: 4,
      end: 4,
    });
  });

  it("opens a pair after the closer once the caret is past it", () => {
    expect(applyFormat("say **loud**", 12, 12, "bold")).toEqual({
      value: "say **loud******",
      start: 14,
      end: 14,
    });
  });
});

describe("applyFormat: line prefixes", () => {
  it("prefixes the line the caret is on", () => {
    expect(applyFormat("wise words", 10, 10, "quote")).toEqual({
      value: "> wise words",
      start: 0,
      end: 12,
    });
  });

  it("prefixes an empty line", () => {
    expect(applyFormat("", 0, 0, "quote")).toEqual({
      value: "> ",
      start: 0,
      end: 2,
    });
  });

  it("finds the line's bounds when the caret is mid-document", () => {
    expect(applyFormat("one\ntwo\nthree", 5, 5, "quote")).toEqual({
      value: "one\n> two\nthree",
      start: 4,
      end: 9,
    });
  });

  it("prefixes every line the selection touches", () => {
    expect(applyFormat("milk\neggs", 2, 6, "list")).toEqual({
      value: "- milk\n- eggs",
      start: 0,
      end: 13,
    });
  });

  it("numbers an ordered list as it writes it", () => {
    expect(applyFormat("milk\neggs\nbread", 0, 15, "orderedList")).toEqual({
      value: "1. milk\n2. eggs\n3. bread",
      start: 0,
      end: 24,
    });
  });

  it("numbers from 1 within the selection, ignoring the lines above", () => {
    const { value } = applyFormat("1. milk\neggs", 8, 12, "orderedList");
    expect(value).toBe("1. milk\n1. eggs");
  });

  it("removes the prefix when every line already has it", () => {
    expect(applyFormat("- milk\n- eggs", 0, 13, "list")).toEqual({
      value: "milk\neggs",
      start: 0,
      end: 9,
    });
  });

  it("swaps one list style for the other rather than stacking them", () => {
    expect(applyFormat("- a thing", 9, 9, "orderedList")).toEqual({
      value: "1. a thing",
      start: 0,
      end: 10,
    });
    expect(applyFormat("1. a thing", 10, 10, "list")).toEqual({
      value: "- a thing",
      start: 0,
      end: 9,
    });
  });

  it("recognises a list a human typed, spaces and markers alike", () => {
    expect(applyFormat("* milk", 0, 6, "list").value).toBe("milk");
    expect(applyFormat("1) milk", 0, 7, "orderedList").value).toBe("milk");
    expect(applyFormat(">milk", 0, 5, "quote").value).toBe("milk");
  });

  it("leaves the whole rewritten line selected, prefix included", () => {
    const { start, end, value } = applyFormat("one\ntwo", 5, 5, "quote");
    expect(value.slice(start, end)).toBe("> two");
    expect([start, end]).toEqual([4, 9]);
  });

  it("leaves a trailing newline outside the block", () => {
    expect(applyFormat("milk\neggs\n", 0, 9, "list")).toEqual({
      value: "- milk\n- eggs\n",
      start: 0,
      end: 13,
    });
  });

  // Selecting the newline pulls in the empty line after it, which then
  // gets a prefix of its own.
  it("prefixes the empty line when the selection includes the newline", () => {
    expect(applyFormat("milk\neggs\n", 0, 10, "list")).toEqual({
      value: "- milk\n- eggs\n- ",
      start: 0,
      end: 16,
    });
  });

  // "Already prefixed" is all-or-nothing, so a half-quoted block gains a
  // second level on the line that had one.
  it("re-prefixes a line that already had one when its neighbour did not", () => {
    expect(applyFormat("> one\ntwo", 0, 9, "quote").value).toBe(
      "> > one\n> two",
    );
  });
});

describe("applyFormat: code block", () => {
  it("fences the selection on its own lines", () => {
    expect(applyFormat("x := 1", 0, 6, "codeblock")).toEqual({
      value: "```\nx := 1\n```",
      start: 4,
      end: 10,
    });
  });

  it("keeps the fenced text selected", () => {
    const { value, start, end } = applyFormat("a\nb", 0, 3, "codeblock");
    expect(value).toBe("```\na\nb\n```");
    expect(value.slice(start, end)).toBe("a\nb");
  });

  it("does not add a blank line when the text already ends in one", () => {
    expect(applyFormat("> wise words\nx := 1", 13, 19, "codeblock")).toEqual({
      value: "> wise words\n```\nx := 1\n```",
      start: 17,
      end: 23,
    });
  });

  it("breaks out of the current line and back into the rest", () => {
    expect(applyFormat("before after", 7, 12, "codeblock")).toEqual({
      value: "before \n```\nafter\n```",
      start: 12,
      end: 17,
    });
    expect(applyFormat("ab", 1, 1, "codeblock")).toEqual({
      value: "a\n```\n\n```\nb",
      start: 6,
      end: 6,
    });
  });

  it("opens an empty fence with the caret on the blank line", () => {
    const { value, start, end } = applyFormat("", 0, 0, "codeblock");
    expect(value).toBe("```\n\n```");
    expect([start, end]).toEqual([4, 4]);
  });

  // Unlike every other format, this one does not toggle: a second press
  // fences the fence.
  it("nests rather than unfencing", () => {
    expect(applyFormat("```\nx\n```", 0, 9, "codeblock").value).toBe(
      "```\n```\nx\n```\n```",
    );
  });
});

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
