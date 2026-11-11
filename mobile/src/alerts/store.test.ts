import { describe, expect, it, vi } from "vitest";
import { alertsStore, NO_BADGES, type ServerBadges, serverBadges, waitingEverywhere } from "./store";

// Badges whose total is `total`, all of it in the spaces.
const of = (total: number): ServerBadges => ({ activity: total, messages: 0, total });

describe("alertsStore", () => {
  it("has none for a server until it is told, and after the server is taken out", () => {
    const store = alertsStore();
    expect(store.badges("a")).toBe(NO_BADGES);
    store.set("a", { activity: 3, messages: 2, total: 4 });
    expect(store.badges("a")).toEqual({ activity: 3, messages: 2, total: 4 });
    store.set("a", undefined);
    expect(store.badges("a")).toBe(NO_BADGES);
  });

  it("tells its listeners of a change, not of the same badges again", () => {
    const store = alertsStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.set("a", of(3));
    const held = store.badges("a");
    store.set("a", of(3));
    store.set("b", undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.badges("a")).toBe(held);
    // One tab's badge moving is a change, though the total stays.
    store.set("a", { activity: 2, messages: 7, total: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
    // As is a second message in a conversation already unread.
    store.set("a", { activity: 2, messages: 8, total: 3 });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.badges("a").messages).toBe(8);
    store.set("a", undefined);
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
    store.set("a", of(1));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("asks a server again the way it was last told to", async () => {
    const store = alertsStore();
    const refresh = vi.fn().mockResolvedValue(undefined);
    store.setRefresh("a", refresh);
    await store.refresh("a");
    await store.refresh("b");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer session's way when the older one lets go late", async () => {
    const store = alertsStore();
    const older = vi.fn().mockResolvedValue(undefined);
    const newer = vi.fn().mockResolvedValue(undefined);
    const forgetOlder = store.setRefresh("a", older);
    const forgetNewer = store.setRefresh("a", newer);
    forgetOlder();
    await store.refresh("a");
    expect(newer).toHaveBeenCalledTimes(1);
    forgetNewer();
    await store.refresh("a");
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
  });
});

describe("serverBadges", () => {
  const space = (alertCount: number, muted = false) => ({ alertCount, muted });
  const dm = (unreadCount: number, flags: { muted?: boolean; closed?: boolean } = {}) => ({
    closed: flags.closed ?? false,
    channel: { unreadCount, muted: flags.muted ?? false },
  });
  const badges = (spaces: unknown[], dms: unknown[]) => serverBadges(spaces as never, dms as never);

  it("has none before the lists are in", () => {
    expect(serverBadges(undefined, undefined)).toEqual(NO_BADGES);
  });

  it("keeps direct messages out of Activity's badge and counts their messages on Messages'", () => {
    expect(badges([space(2), space(1)], [dm(7), dm(1), dm(0)])).toEqual({ activity: 3, messages: 8, total: 5 });
  });

  it("counts nothing muted or closed", () => {
    expect(badges([space(2), space(9, true)], [dm(4), dm(5, { muted: true }), dm(6, { closed: true })])).toEqual({
      activity: 2,
      messages: 4,
      total: 3,
    });
  });
});

describe("waitingEverywhere", () => {
  const totals = (by: Record<string, number>) => (id: string) => by[id] ?? 0;

  it("adds up every saved server's total", () => {
    expect(waitingEverywhere([{ id: "a" }, { id: "b" }, { id: "c" }], totals({ a: 2, b: 60, c: 1 }))).toBe(63);
  });

  it("is none with no saved servers, or nothing waiting", () => {
    expect(waitingEverywhere([], totals({ a: 2 }))).toBe(0);
    expect(waitingEverywhere([{ id: "a" }, { id: "b" }], totals({}))).toBe(0);
  });

  it("adds nothing for a server that has not answered or whose sign-in has ended", () => {
    const store = alertsStore();
    store.set("a", of(5));
    store.set("ended", of(0));
    expect(waitingEverywhere([{ id: "a" }, { id: "ended" }, { id: "silent" }], (id) => store.badges(id).total)).toBe(5);
  });

  it("leaves out a server no longer saved", () => {
    expect(waitingEverywhere([{ id: "a" }], totals({ a: 2, gone: 9 }))).toBe(2);
  });

  it("takes a forgotten server's count out and a new one's in", () => {
    const store = alertsStore();
    store.set("a", of(2));
    store.set("b", of(3));
    expect(waitingEverywhere([{ id: "a" }, { id: "b" }], (id) => store.badges(id).total)).toBe(5);
    store.set("b", undefined);
    expect(waitingEverywhere([{ id: "a" }], (id) => store.badges(id).total)).toBe(2);
    store.set("c", of(4));
    expect(waitingEverywhere([{ id: "a" }, { id: "c" }], (id) => store.badges(id).total)).toBe(6);
  });
});
