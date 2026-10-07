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
  let calls: string[];
  let muted: boolean;
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    muted = true;
  });
  afterEach(() => vi.useRealTimers());
  const hold = () =>
    createHold({
      muted: () => muted,
      mute: () => {
        calls.push("mute");
        muted = true;
      },
      unmute: () => {
        calls.push("unmute");
        muted = false;
      },
    });

  it("unmutes on the press and mutes a tail after the release", () => {
    const h = hold();
    h.press();
    expect(calls).toEqual(["unmute"]);
    h.release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS - 1);
    expect(calls).toEqual(["unmute"]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["unmute", "mute"]);
  });

  it("unmutes once however often the key repeats", () => {
    const h = hold();
    h.press();
    h.press();
    h.press();
    expect(calls).toEqual(["unmute"]);
  });

  it("does nothing when you were not muted to start", () => {
    muted = false;
    const h = hold();
    h.press();
    h.release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS);
    expect(calls).toEqual([]);
  });

  it("carries on the same hold when pressed again inside the tail", () => {
    const h = hold();
    h.press();
    h.release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS / 2);
    h.press();
    vi.advanceTimersByTime(RELEASE_TAIL_MS * 2);
    expect(calls).toEqual(["unmute"]);
    h.release();
    vi.advanceTimersByTime(RELEASE_TAIL_MS);
    expect(calls).toEqual(["unmute", "mute"]);
  });

  it("mutes when stopped mid-hold or mid-tail, and not after", () => {
    const h = hold();
    h.press();
    h.stop();
    expect(calls).toEqual(["unmute", "mute"]);
    h.press();
    h.release();
    h.stop();
    vi.advanceTimersByTime(RELEASE_TAIL_MS * 2);
    expect(calls).toEqual(["unmute", "mute", "unmute", "mute"]);
  });

  it("does nothing when stopped while not holding", () => {
    hold().stop();
    expect(calls).toEqual([]);
  });
});
