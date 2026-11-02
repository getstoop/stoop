import { describe, expect, it, vi } from "vitest";
import type { SavedServer } from "../api/servers";
import { serverList, type ServerListView } from "./serverList";

const ONE: SavedServer = { id: "aaaaaa", origin: "https://one.example", name: "One" };
const TWO: SavedServer = { id: "bbbbbb", origin: "https://two.example", name: "Two" };

function setup(load: () => Promise<SavedServer[]>) {
  const views: ServerListView[] = [];
  const list = serverList(load, (view) => views.push(view));
  return { ...list, views, last: () => views[views.length - 1] };
}

const refused = () => Promise.reject(new Error("locked"));

// A promise the test settles by hand.
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("serverList", () => {
  it("publishes an empty list as known, not as unread", async () => {
    const { read, last } = setup(async () => []);
    await read();
    expect(last()).toEqual({ state: "known", servers: [] });
  });

  it("publishes a failed read as unread, and the next read's list once it works", async () => {
    const load = vi.fn<() => Promise<SavedServer[]>>().mockImplementationOnce(refused).mockResolvedValue([ONE, TWO]);
    const { read, last } = setup(load);
    await read();
    expect(last()).toEqual({ state: "unread" });
    await read();
    expect(last()).toEqual({ state: "known", servers: [ONE, TWO] });
  });

  it("refuses a change before a read has succeeded, without running it", async () => {
    const { read, change, last } = setup(refused);
    const save = vi.fn(async () => [ONE]);
    await expect(change(save)).rejects.toThrow("not been read");
    await read();
    await expect(change(save)).rejects.toThrow("not been read");
    expect(save).not.toHaveBeenCalled();
    expect(last()).toEqual({ state: "unread" });
  });

  it("runs a change after a refused one on the list that was read", async () => {
    const load = vi.fn<() => Promise<SavedServer[]>>().mockImplementationOnce(refused).mockResolvedValue([ONE]);
    const { read, change } = setup(load);
    await read();
    await expect(change(async () => [])).rejects.toThrow();
    await read();
    expect(await change(async (list) => [TWO, ...list])).toEqual([TWO, ONE]);
  });

  it("doesn't read again once a read has succeeded, so a change stands", async () => {
    const load = vi.fn(async () => [ONE]);
    const { read, change, last } = setup(load);
    await read();
    await change(async () => [TWO, ONE]);
    await read();
    expect(load).toHaveBeenCalledTimes(1);
    expect(last()).toEqual({ state: "known", servers: [TWO, ONE] });
  });

  it("holds one read at a time, and reads once more if one asked for meanwhile would be missed", async () => {
    const first = pending<SavedServer[]>();
    const load = vi.fn<() => Promise<SavedServer[]>>().mockReturnValueOnce(first.promise).mockResolvedValue([ONE]);
    const { read, views } = setup(load);
    const out = read();
    await read();
    expect(load).toHaveBeenCalledTimes(1);
    first.reject(new Error("locked"));
    await out;
    expect(load).toHaveBeenCalledTimes(2);
    // Never unread on the way: the second read answered for both.
    expect(views).toEqual([{ state: "known", servers: [ONE] }]);
  });

  it("can read again after a failed read, with one asked for meanwhile also failing", async () => {
    const load = vi.fn(refused);
    const { read, last } = setup(load);
    const out = read();
    await read();
    await out;
    expect(load).toHaveBeenCalledTimes(2);
    expect(last()).toEqual({ state: "unread" });
    await read();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("doesn't read again after a success just because one was asked for meanwhile", async () => {
    const first = pending<SavedServer[]>();
    const load = vi.fn(() => first.promise);
    const { read } = setup(load);
    const out = read();
    await read();
    first.resolve([ONE]);
    await out;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("runs changes one at a time, each on the list the one before left", async () => {
    const { read, change } = setup(async () => [ONE]);
    await read();
    const gate = pending<void>();
    const slow = change(async (list) => {
      await gate.promise;
      return [TWO, ...list];
    });
    const next = change(async (list) => list.filter((s) => s.id !== ONE.id));
    gate.resolve();
    await slow;
    expect(await next).toEqual([TWO]);
  });

  it("keeps the list when a change fails, and carries on", async () => {
    const { read, change, last } = setup(async () => [ONE]);
    await read();
    await expect(change(() => Promise.reject(new Error("write failed")))).rejects.toThrow("write failed");
    expect(last()).toEqual({ state: "known", servers: [ONE] });
    expect(await change(async (list) => [TWO, ...list])).toEqual([TWO, ONE]);
  });
});
