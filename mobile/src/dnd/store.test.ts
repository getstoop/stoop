import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it, vi } from "vitest";
import type { SavedServer } from "../api/servers";
import { type AccountDnd, dndStore } from "./store";
import { DND_OFF, type DndSwitch, turnedOn } from "./switch";

const NOW = Date.parse("2026-09-15T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const elm: SavedServer = { id: "elm", origin: "https://elm.example", name: "Elm Street" };
const oak: SavedServer = { id: "oak", origin: "https://oak.example", name: "Oak Lane" };

const ON: AccountDnd = { dnd: true, dndUntil: undefined };
const NOT_ON: AccountDnd = { dnd: false, dndUntil: undefined };
const until = (ms: number): AccountDnd => ({ dnd: true, dndUntil: timestampFromDate(new Date(ms)) });

// A store on a clock the test moves, with every call it makes kept.
function setup() {
  const clock = { now: NOW };
  const send = vi.fn(async (_server: SavedServer, on: boolean, end: Date | undefined): Promise<AccountDnd | undefined> =>
    on ? { dnd: true, dndUntil: end && timestampFromDate(end) } : NOT_ON,
  );
  const account = vi.fn(async (_server: SavedServer): Promise<AccountDnd | undefined> => NOT_ON);
  const save = vi.fn<(next: DndSwitch) => void>();
  const store = dndStore({ send, account, save, now: () => clock.now });
  return { clock, send, account, save, store };
}

// Lets every call already made be answered.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the switch", () => {
  it("is off until the saved one is read, then as saved", () => {
    const { store } = setup();
    expect(store.current()).toBe(DND_OFF);
    const saved = turnedOn("3h", NOW - HOUR);
    store.loaded(saved);
    expect(store.current()).toBe(saved);
  });

  it("reads as off once its end has passed, and tells no server", () => {
    const { clock, send, store } = setup();
    store.loaded(DND_OFF);
    store.connected(elm);
    store.set(turnedOn("1h", NOW), [elm]);
    send.mockClear();
    clock.now = NOW + HOUR;
    expect(store.current()).toBe(DND_OFF);
    expect(store.holds("elm")).toBe(false);
    // A connect after the end is told nothing either.
    store.connected(elm);
    expect(send).not.toHaveBeenCalled();
  });

  it("is saved, and its listeners told, when the person moves it", () => {
    const { save, store } = setup();
    store.loaded(DND_OFF);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const next = turnedOn("1d", NOW);
    store.set(next, []);
    expect(save).toHaveBeenCalledWith(next);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set(DND_OFF, []);
    expect(save).toHaveBeenLastCalledWith(DND_OFF);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("what each server is told", () => {
  it("is on with the same end, on every saved server, when the switch goes on", () => {
    const { send, store } = setup();
    store.loaded(DND_OFF);
    store.set(turnedOn("3h", NOW), [elm, oak]);
    expect(send.mock.calls).toEqual([
      [elm, true, new Date(NOW + 3 * HOUR)],
      [oak, true, new Date(NOW + 3 * HOUR)],
    ]);
  });

  it("is on with no end for never expire", () => {
    const { send, store } = setup();
    store.loaded(DND_OFF);
    store.set(turnedOn("never", NOW), [elm]);
    expect(send.mock.calls).toEqual([[elm, true, undefined]]);
  });

  it("is off, on every saved server, when the person turns it off", () => {
    const { send, store } = setup();
    store.loaded(turnedOn("1h", NOW));
    store.set(DND_OFF, [elm, oak]);
    expect(send.mock.calls).toEqual([
      [elm, false, undefined],
      [oak, false, undefined],
    ]);
  });

  it("is never off as the app starts or a server connects: only its account is read", () => {
    const { send, account, store } = setup();
    store.connected(elm);
    store.loaded(DND_OFF);
    store.connected(oak);
    store.connected(elm);
    expect(send).not.toHaveBeenCalled();
    expect(account.mock.calls).toEqual([[elm], [oak], [elm]]);
  });

  it("is nothing for a saved switch whose end passed while the app was closed", () => {
    const { send, store } = setup();
    store.connected(elm);
    store.loaded(turnedOn("1h", NOW - 2 * HOUR));
    store.connected(oak);
    expect(send).not.toHaveBeenCalled();
  });

  it("is on when a server connects, or signs in later, while the switch is on", () => {
    const { send, account, store } = setup();
    const saved = turnedOn("1d", NOW - HOUR);
    store.loaded(saved);
    expect(send).not.toHaveBeenCalled();
    store.connected(elm);
    store.connected(oak);
    expect(send.mock.calls).toEqual([
      [elm, true, new Date(NOW + 23 * HOUR)],
      [oak, true, new Date(NOW + 23 * HOUR)],
    ]);
    expect(account).not.toHaveBeenCalled();
  });

  it("is on for a server that connected before the saved switch was read", () => {
    const { send, store } = setup();
    store.connected(elm);
    store.loaded(turnedOn("never", NOW - HOUR));
    expect(send.mock.calls).toEqual([[elm, true, undefined]]);
  });

  it("is on again at the next connect after a call that failed", async () => {
    const { send, store } = setup();
    store.loaded(DND_OFF);
    send.mockRejectedValueOnce(new Error("unreachable"));
    store.set(turnedOn("never", NOW), [elm]);
    await settle();
    store.connected(elm);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(elm, true, undefined);
  });

  it("is nothing more for a server whose session is gone", () => {
    const { send, store } = setup();
    store.connected(elm);
    store.forget("elm");
    store.loaded(turnedOn("never", NOW));
    expect(send).not.toHaveBeenCalled();
  });
});

describe("holds", () => {
  it("holds every server's banners while the switch is on, whatever the servers say", async () => {
    const { send, store } = setup();
    store.loaded(DND_OFF);
    send.mockRejectedValue(new Error("unreachable"));
    store.set(turnedOn("1h", NOW), [elm]);
    await settle();
    expect(store.holds("elm")).toBe(true);
    expect(store.holds("oak")).toBe(true);
  });

  it("holds none with the switch off and no account on do not disturb", async () => {
    const { store } = setup();
    expect(store.holds("elm")).toBe(false);
    store.loaded(DND_OFF);
    store.connected(elm);
    await settle();
    expect(store.holds("elm")).toBe(false);
  });

  it("holds a server whose account says do not disturb, as read on connecting, and no other", async () => {
    const { account, store } = setup();
    store.loaded(DND_OFF);
    account.mockResolvedValueOnce(ON);
    store.connected(elm);
    store.connected(oak);
    await settle();
    expect(store.holds("elm")).toBe(true);
    expect(store.holds("oak")).toBe(false);
  });

  it("follows the server's event, on and off", () => {
    const { store } = setup();
    store.loaded(DND_OFF);
    store.accountChanged("elm", ON);
    expect(store.holds("elm")).toBe(true);
    store.accountChanged("elm", NOT_ON);
    expect(store.holds("elm")).toBe(false);
  });

  it("lets an account's end pass with no word from the server", () => {
    const { clock, store } = setup();
    store.loaded(DND_OFF);
    store.accountChanged("elm", until(NOW + HOUR));
    expect(store.holds("elm")).toBe(true);
    clock.now = NOW + HOUR;
    expect(store.holds("elm")).toBe(false);
  });

  it("keeps holding a server set from elsewhere after the switch is turned off, should that call fail", async () => {
    const { send, store } = setup();
    store.loaded(turnedOn("never", NOW));
    store.accountChanged("elm", ON);
    send.mockRejectedValueOnce(new Error("unreachable"));
    store.set(DND_OFF, [elm]);
    await settle();
    expect(store.holds("elm")).toBe(true);
  });

  it("stops holding once the server answers the switch going off", async () => {
    const { store } = setup();
    store.loaded(turnedOn("never", NOW));
    store.accountChanged("elm", ON);
    store.set(DND_OFF, [elm]);
    await settle();
    expect(store.holds("elm")).toBe(false);
  });

  it("drops an answer older than the server's own event", async () => {
    const { account, store } = setup();
    store.loaded(DND_OFF);
    let answer: (account: AccountDnd) => void = () => {};
    account.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    store.connected(elm);
    store.accountChanged("elm", ON);
    answer(NOT_ON);
    await settle();
    expect(store.holds("elm")).toBe(true);
  });

  it("forgets a server's account with its session", async () => {
    const { account, store } = setup();
    store.loaded(DND_OFF);
    let answer: (account: AccountDnd) => void = () => {};
    account.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    store.connected(elm);
    store.accountChanged("elm", ON);
    store.forget("elm");
    expect(store.holds("elm")).toBe(false);
    // What the old session asked lands on nothing.
    answer(ON);
    await settle();
    expect(store.holds("elm")).toBe(false);
  });
});
