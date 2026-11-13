import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastSpaceStore } from "../../lastSpace/store";
import { landOn } from "./landed";

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
    let landed = false;
    const wait = landOn(store, "server", "books", 5000).then(() => {
      landed = true;
    });
    expect(store.asked("server")).toBe("books");
    await Promise.resolve();
    expect(landed).toBe(false);
    store.remember("server", "books");
    await Promise.resolve();
    expect(landed).toBe(false);
    store.answered("server");
    await wait;
    expect(landed).toBe(true);
  });

  it("gives up waiting when nothing answers", async () => {
    const store = lastSpaceStore(() => {});
    store.loaded({});
    let landed = false;
    const wait = landOn(store, "server", "books", 5000).then(() => {
      landed = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(landed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(landed).toBe(true);
  });
});
