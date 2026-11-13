import { describe, expect, it, vi } from "vitest";
import { lastSpaceStore } from "./store";

describe("lastSpaceStore", () => {
  it("knows nothing until the saved map is read", () => {
    expect(lastSpaceStore(vi.fn()).current()).toBeUndefined();
  });

  it("takes the saved map once read, tells the listeners and doesn't save it again", () => {
    const save = vi.fn();
    const store = lastSpaceStore(save);
    const listener = vi.fn();
    store.subscribe(listener);
    const saved = { home: "books" };
    store.loaded(saved);
    expect(store.current()).toBe(saved);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("counts only the first read", () => {
    const store = lastSpaceStore(vi.fn());
    store.loaded({ home: "books" });
    store.loaded({ home: "garden" });
    expect(store.current()).toEqual({ home: "books" });
  });

  it("remembers a server's space, saving the whole map and telling the listeners", () => {
    const save = vi.fn();
    const store = lastSpaceStore(save);
    store.loaded({ home: "books" });
    const listener = vi.fn();
    store.subscribe(listener);
    store.remember("work", "standup");
    expect(store.current()).toEqual({ home: "books", work: "standup" });
    expect(save).toHaveBeenCalledWith({ home: "books", work: "standup" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("says nothing for a space already remembered", () => {
    const save = vi.fn();
    const store = lastSpaceStore(save);
    store.loaded({ home: "books" });
    const listener = vi.fn();
    store.subscribe(listener);
    store.remember("home", "books");
    expect(save).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("forgets a removed server's space, and says nothing for one it had none for", () => {
    const save = vi.fn();
    const store = lastSpaceStore(save);
    store.loaded({ home: "books", work: "standup" });
    store.forgetServer("club");
    expect(save).not.toHaveBeenCalled();
    store.forgetServer("home");
    expect(store.current()).toEqual({ work: "standup" });
    expect(save).toHaveBeenCalledWith({ work: "standup" });
  });

  it("lays a change made before the read over what was saved, and saves the result", () => {
    const save = vi.fn();
    const store = lastSpaceStore(save);
    store.remember("work", "standup");
    store.forgetServer("home");
    expect(store.current()).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    store.loaded({ home: "books", club: "chess" });
    expect(store.current()).toEqual({ club: "chess", work: "standup" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ club: "chess", work: "standup" });
  });

  it("holds a space asked for until it is answered, telling the listeners and saving nothing", () => {
    const save = vi.fn();
    const store = lastSpaceStore(save);
    store.loaded({ home: "books" });
    const listener = vi.fn();
    store.subscribe(listener);
    store.ask("home", "garden");
    expect(store.asked("home")).toBe("garden");
    expect(store.asked("work")).toBeUndefined();
    expect(store.current()).toEqual({ home: "books" });
    expect(listener).toHaveBeenCalledTimes(1);
    store.answered("home");
    expect(store.asked("home")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    store.answered("home");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = lastSpaceStore(vi.fn());
    store.loaded({});
    const listener = vi.fn();
    store.subscribe(listener)();
    store.remember("home", "books");
    expect(listener).not.toHaveBeenCalled();
  });
});
