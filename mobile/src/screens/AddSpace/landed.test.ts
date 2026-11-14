import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastSpaceStore } from "../../lastSpace/store";
import { landOn, withdraw } from "./landed";

describe("landOn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the space and waits for the tab's answer", async () => {
    const store = lastSpaceStore(() => {});
    store.loaded({});
    let landed: string | undefined;
    const wait = landOn(store, "server", "books", 5000).then((how) => {
      landed = how;
    });
    expect(store.asked("server")).toBe("books");
    await Promise.resolve();
    expect(landed).toBeUndefined();
    store.remember("server", "books");
    await Promise.resolve();
    expect(landed).toBeUndefined();
    store.answered("server");
    await wait;
    expect(landed).toBe("answered");
  });

  it("says when something else asked for another space first", async () => {
    const store = lastSpaceStore(() => {});
    store.loaded({});
    const wait = landOn(store, "server", "books", 5000);
    store.ask("server", "garden");
    expect(await wait).toBe("replaced");
    expect(store.asked("server")).toBe("garden");
  });

  it("gives up waiting when nothing answers", async () => {
    const store = lastSpaceStore(() => {});
    store.loaded({});
    let landed: string | undefined;
    const wait = landOn(store, "server", "books", 5000).then((how) => {
      landed = how;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(landed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(landed).toBe("gave-up");
    // Still asked: the tab picks the space when it next answers.
    expect(store.asked("server")).toBe("books");
  });
});

describe("withdraw", () => {
  it("takes back the space asked for, and only that one", () => {
    const store = lastSpaceStore(() => {});
    store.loaded({});
    store.ask("server", "books");
    withdraw(store, "server", "garden");
    expect(store.asked("server")).toBe("books");
    withdraw(store, "server", "books");
    expect(store.asked("server")).toBeUndefined();
  });
});
