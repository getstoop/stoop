import { describe, expect, it, vi } from "vitest";
import { rosterStore } from "./rosterStore";

describe("rosterStore", () => {
  it("holds a roster per server, undefined until one is set", () => {
    const store = rosterStore<string[]>();
    const roster = ["sam"];
    store.set("alpha", roster);
    expect(store.get("alpha")).toBe(roster);
    expect(store.get("beta")).toBeUndefined();
    store.set("alpha", undefined);
    expect(store.get("alpha")).toBeUndefined();
  });

  it("tells whoever is listening about a change, and nothing when the roster is the same", () => {
    const store = rosterStore<string[]>();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const roster = ["sam"];
    store.set("alpha", roster);
    expect(listener).toHaveBeenCalledTimes(1);
    store.set("alpha", roster);
    store.set("beta", undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set("alpha", undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
