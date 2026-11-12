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

  it("stops telling a listener that unsubscribed", () => {
    const store = alertPrefsStore(vi.fn());
    const listener = vi.fn();
    store.subscribe(listener)();
    store.set({ threads: true });
    expect(listener).not.toHaveBeenCalled();
  });
});
