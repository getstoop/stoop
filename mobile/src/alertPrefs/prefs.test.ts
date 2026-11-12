import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, kindAlerts, parsePrefs, serverAlerts, withoutServer, withServer } from "./prefs";

describe("parsePrefs", () => {
  it("is the defaults for nothing saved or what can't be read", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{nope")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("null")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("3")).toEqual(DEFAULT_PREFS);
  });

  it("has threads off and the rest on by default", () => {
    expect(DEFAULT_PREFS).toEqual({ mentions: true, directMessages: true, threads: false, showText: true, servers: {} });
  });

  it("reads a saved value back", () => {
    const saved = { mentions: false, directMessages: false, threads: true, showText: false, servers: { a: false, b: true } };
    expect(parsePrefs(JSON.stringify(saved))).toEqual(saved);
  });

  it("keeps what it can of a partly bad save", () => {
    expect(parsePrefs(JSON.stringify({ mentions: false, threads: "yes" }))).toEqual({
      ...DEFAULT_PREFS,
      mentions: false,
    });
  });
});

describe("servers", () => {
  it("reads a server's saved switch, and keeps only booleans", () => {
    const raw = JSON.stringify({ servers: { a: false, b: true, c: "no", d: null } });
    expect(parsePrefs(raw).servers).toEqual({ a: false, b: true });
  });

  it("reads a save with no servers, or a bad one, as none", () => {
    expect(parsePrefs(JSON.stringify({ mentions: false })).servers).toEqual({});
    expect(parsePrefs(JSON.stringify({ servers: [true] })).servers).toEqual({});
    expect(parsePrefs(JSON.stringify({ servers: "a" })).servers).toEqual({});
  });

  it("is on unless turned off", () => {
    expect(serverAlerts(DEFAULT_PREFS, "a")).toBe(true);
    expect(serverAlerts({ servers: { a: false } }, "a")).toBe(false);
    expect(serverAlerts({ servers: { a: false } }, "b")).toBe(true);
    expect(serverAlerts({ servers: { a: true } }, "a")).toBe(true);
  });

  it("sets one server and leaves the others", () => {
    const next = withServer({ ...DEFAULT_PREFS, servers: { b: false } }, "a", false);
    expect(next.servers).toEqual({ a: false, b: false });
  });

  it("drops a removed server's switch, so a later one with its ID is on", () => {
    const prefs = { ...DEFAULT_PREFS, servers: { a: false, b: false } };
    const next = withoutServer(prefs, "a");
    expect(next.servers).toEqual({ b: false });
    expect(serverAlerts(next, "a")).toBe(true);
  });

  it("is the same prefs when the server had no switch", () => {
    expect(withoutServer(DEFAULT_PREFS, "a")).toBe(DEFAULT_PREFS);
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
