import { describe, expect, it } from "vitest";
import { isTypingTarget, type KeyPress, matchShortcut } from "./shortcuts";

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("matchShortcut", () => {
  it("matches a bare key when nobody is typing", () => {
    expect(matchShortcut(press("f"), false)).toBe("stageFullscreen");
  });

  it("leaves a bare key to the field while typing", () => {
    expect(matchShortcut(press("f"), true)).toBeNull();
  });

  it("matches a modified key with Cmd or Ctrl, typing or not", () => {
    const shift = { shiftKey: true };
    expect(matchShortcut(press("M", { ...shift, metaKey: true }), true)).toBe(
      "toggleMute",
    );
    expect(matchShortcut(press("D", { ...shift, ctrlKey: true }), false)).toBe(
      "toggleDeafen",
    );
  });

  it("needs the modifiers to match exactly", () => {
    expect(matchShortcut(press("f", { metaKey: true }), false)).toBeNull();
    expect(matchShortcut(press("F", { shiftKey: true }), false)).toBeNull();
    expect(matchShortcut(press("m", { metaKey: true }), false)).toBeNull();
    expect(
      matchShortcut(
        press("M", { metaKey: true, shiftKey: true, altKey: true }),
        false,
      ),
    ).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("counts fields and editable content", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it("does not count anything else", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
