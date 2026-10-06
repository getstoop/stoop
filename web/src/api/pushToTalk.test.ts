import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHold, RELEASE_TAIL_MS } from "./pushToTalk";
import {
  isPushToTalkPress,
  isPushToTalkRelease,
  type KeyHold,
} from "./shortcuts";

const key = (code: string, mods: Partial<KeyHold> = {}): KeyHold => ({
  code,
  key: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("the push to talk key", () => {
  it("is Ctrl and the key above Tab, on every platform", () => {
    expect(isPushToTalkPress(key("Backquote", { ctrlKey: true }))).toBe(true);
  });

  it("is not Cmd+`, which is macOS's next window", () => {
    expect(isPushToTalkPress(key("Backquote", { metaKey: true }))).toBe(false);
    expect(
      isPushToTalkPress(key("Backquote", { ctrlKey: true, metaKey: true })),
    ).toBe(false);
  });

  it("is not the bare key, which types", () => {
    expect(isPushToTalkPress(key("Backquote"))).toBe(false);
  });

  it("ends when either half comes up", () => {
    expect(isPushToTalkRelease(key("Backquote"))).toBe(true);
    expect(isPushToTalkRelease(key("ControlLeft", { key: "Control" }))).toBe(
      true,
    );
    expect(isPushToTalkRelease(key("KeyA", { key: "a" }))).toBe(false);
  });
});

describe("createHold", () => {
  let sent: boolean[];
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
  });
  afterEach(() => vi.useRealTimers());
  const hold = () => createHold((open) => sent.push(open));

  it("opens on the press and shuts a tail after the release", () => {
    const h = hold();
    h.press();
    expect(sent).toEqual([true]);
    h.release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS - 1);
    expect(sent).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([true, false]);
  });

  it("opens once however often the key repeats", () => {
    const h = hold();
    h.press();
    h.press();
    h.press();
    expect(sent).toEqual([true]);
  });

  it("stays open when pressed again inside the tail", () => {
    const h = hold();
    h.press();
    h.release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS / 2);
    h.press();
    vi.advanceTimersByTime(RELEASE_TAIL_MS * 2);
    // Asked to open again, never shut in between.
    expect(sent).toEqual([true, true]);
    h.release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS);
    expect(sent).toEqual([true, true, false]);
  });

  it("shuts at once when cut, with no tail and nothing late", () => {
    const h = hold();
    h.press();
    h.cut();
    expect(sent).toEqual([true, false]);
    vi.advanceTimersByTime(RELEASE_TAIL_MS * 2);
    expect(sent).toEqual([true, false]);
  });

  it("cuts a mic still in its tail", () => {
    const h = hold();
    h.press();
    h.release();
    h.cut();
    expect(sent).toEqual([true, false]);
    vi.advanceTimersByTime(RELEASE_TAIL_MS * 2);
    expect(sent).toEqual([true, false]);
  });

  it("does nothing when cut while shut", () => {
    hold().cut();
    expect(sent).toEqual([]);
  });

  it("ignores a release it never saw pressed", () => {
    hold().release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS);
    expect(sent).toEqual([]);
  });
});
