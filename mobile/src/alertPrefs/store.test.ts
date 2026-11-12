import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS } from "./prefs";
import { alertPrefsStore } from "./store";

describe("alertPrefsStore", () => {
  it("starts on the defaults", () => {
    expect(alertPrefsStore(vi.fn()).current()).toBe(DEFAULT_PREFS);
  });

  it("changes one pref, saves all and tells the listeners", () => {
    const save = vi.fn();
    const store = alertPrefsStore(save);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ threads: true });
    expect(store.current()).toEqual({ ...DEFAULT_PREFS, threads: true });
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_PREFS, threads: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("takes the saved prefs once read, without saving them again", () => {
    const save = vi.fn();
    const store = alertPrefsStore(save);
    store.loaded({ ...DEFAULT_PREFS, mentions: false });
    expect(store.current().mentions).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("drops a read that lands after the person changed one", () => {
    const store = alertPrefsStore(vi.fn());
    store.set({ showText: false });
    store.loaded({ ...DEFAULT_PREFS, mentions: false });
    expect(store.current()).toEqual({ ...DEFAULT_PREFS, showText: false });
  });

  it("sets a server's switch, saving all", () => {
    const save = vi.fn();
    const store = alertPrefsStore(save);
    store.setServer("a", false);
    expect(store.current().servers).toEqual({ a: false });
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_PREFS, servers: { a: false } });
  });

  it("forgets a removed server's switch, and says nothing for one it had none for", () => {
    const save = vi.fn();
    const store = alertPrefsStore(save);
    store.setServer("a", false);
    save.mockClear();
    store.forgetServer("b");
    expect(save).not.toHaveBeenCalled();
    store.forgetServer("a");
    expect(store.current().servers).toEqual({});
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = alertPrefsStore(vi.fn());
    const listener = vi.fn();
    store.subscribe(listener)();
    store.set({ threads: true });
    expect(listener).not.toHaveBeenCalled();
  });
});
