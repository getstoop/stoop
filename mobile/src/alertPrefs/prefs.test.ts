import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, kindAlerts, parsePrefs } from "./prefs";

describe("parsePrefs", () => {
  it("is the defaults for nothing saved or what can't be read", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{nope")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("null")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("3")).toEqual(DEFAULT_PREFS);
  });

  it("has everything on by default", () => {
    expect(DEFAULT_PREFS).toEqual({ mentions: true, directMessages: true, threads: true, showText: true });
  });

  it("reads a saved value back", () => {
    const saved = { mentions: false, directMessages: false, threads: true, showText: false };
    expect(parsePrefs(JSON.stringify(saved))).toEqual(saved);
  });

  it("keeps what it can of a partly bad save", () => {
    expect(parsePrefs(JSON.stringify({ mentions: false, threads: "yes" }))).toEqual({
      ...DEFAULT_PREFS,
      mentions: false,
    });
  });
});

describe("kindAlerts", () => {
  const off = { mentions: false, directMessages: false, threads: false };
  const on = { mentions: true, directMessages: true, threads: true };

  it("puts a mention and a reply under mentions", () => {
    expect(kindAlerts({ ...off, mentions: true }, ActivityKind.MENTION)).toBe(true);
    expect(kindAlerts({ ...off, mentions: true }, ActivityKind.REPLY)).toBe(true);
    expect(kindAlerts({ ...on, mentions: false }, ActivityKind.MENTION)).toBe(false);
    expect(kindAlerts({ ...on, mentions: false }, ActivityKind.REPLY)).toBe(false);
  });

  it("puts a direct message under direct messages", () => {
    expect(kindAlerts({ ...off, directMessages: true }, ActivityKind.DM)).toBe(true);
    expect(kindAlerts({ ...on, directMessages: false }, ActivityKind.DM)).toBe(false);
  });

  it("puts a thread's reply under threads", () => {
    expect(kindAlerts({ ...off, threads: true }, ActivityKind.THREAD_REPLY)).toBe(true);
    expect(kindAlerts({ ...on, threads: false }, ActivityKind.THREAD_REPLY)).toBe(false);
  });

  it("keeps ringing for a kind that fits no switch", () => {
    expect(kindAlerts(off, ActivityKind.UNSPECIFIED)).toBe(true);
    expect(kindAlerts(off, 99)).toBe(true);
  });
});
