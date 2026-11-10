import { describe, expect, it, vi } from "vitest";
import { alertsStore, waitingEverywhere } from "./store";

describe("alertsStore", () => {
  it("has none for a server until it is told, and after the server is taken out", () => {
    const store = alertsStore();
    expect(store.total("a")).toBe(0);
    store.set("a", 3);
    expect(store.total("a")).toBe(3);
    store.set("a", undefined);
    expect(store.total("a")).toBe(0);
  });

  it("tells its listeners of a change, not of the same total again", () => {
    const store = alertsStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.set("a", 3);
    store.set("a", 3);
    store.set("b", undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    store.set("a", undefined);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    store.set("a", 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("asks a server again the way it was last told to", async () => {
    const store = alertsStore();
    const refresh = vi.fn().mockResolvedValue(undefined);
    store.loadWith("a", refresh);
    await store.refresh("a");
    await store.refresh("b");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer session's way when the older one lets go late", async () => {
    const store = alertsStore();
    const older = vi.fn().mockResolvedValue(undefined);
    const newer = vi.fn().mockResolvedValue(undefined);
    const forgetOlder = store.loadWith("a", older);
    const forgetNewer = store.loadWith("a", newer);
    forgetOlder();
    await store.refresh("a");
    expect(newer).toHaveBeenCalledTimes(1);
    forgetNewer();
    await store.refresh("a");
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
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
    store.set("a", 5);
    store.set("ended", 0);
    expect(waitingEverywhere([{ id: "a" }, { id: "ended" }, { id: "silent" }], store.total)).toBe(5);
  });

  it("leaves out a server no longer saved", () => {
    expect(waitingEverywhere([{ id: "a" }], totals({ a: 2, gone: 9 }))).toBe(2);
  });

  it("takes a forgotten server's count out and a new one's in", () => {
    const store = alertsStore();
    store.set("a", 2);
    store.set("b", 3);
    expect(waitingEverywhere([{ id: "a" }, { id: "b" }], store.total)).toBe(5);
    store.set("b", undefined);
    expect(waitingEverywhere([{ id: "a" }], store.total)).toBe(2);
    store.set("c", 4);
    expect(waitingEverywhere([{ id: "a" }, { id: "c" }], store.total)).toBe(6);
  });
});
