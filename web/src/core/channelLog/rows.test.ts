import { describe, expect, it } from "vitest";
import { isShown, mergeRows, showsInChannel } from "./rows";
import { message } from "./testing";

const held = new Map([["a", message("a", { content: "first", seq: 5n })]]);

describe("merge by seq", () => {
  it("replaces the held copy with a higher seq", () => {
    const merged = mergeRows(
      held,
      [message("a", { content: "second", seq: 6n })],
      false,
    );
    expect(merged.get("a")?.content).toBe("second");
  });

  it("ignores an equal seq", () => {
    const merged = mergeRows(
      held,
      [message("a", { content: "other", seq: 5n })],
      false,
    );
    expect(merged).toBe(held);
  });

  it("ignores a lower seq", () => {
    const merged = mergeRows(
      held,
      [message("a", { content: "older", seq: 4n })],
      false,
    );
    expect(merged).toBe(held);
    expect(merged.get("a")?.content).toBe("first");
  });

  it("adds a row it did not hold", () => {
    const merged = mergeRows(held, [message("b", { seq: 1n })], false);
    expect([...merged.keys()]).toEqual(["a", "b"]);
  });

  it("keeps the reader's half of a thread summary from the held copy", () => {
    const root = new Map([
      [
        "r",
        message("r", {
          seq: 1n,
          thread: {
            replyCount: 1,
            participating: true,
            muted: true,
            unreadCount: 3,
          },
        }),
      ],
    ]);
    const fromEvent = message("r", { seq: 2n, thread: { replyCount: 2 } });
    const kept = mergeRows(root, [fromEvent], true).get("r")?.thread;
    expect(kept).toMatchObject({
      replyCount: 2,
      participating: true,
      muted: true,
      unreadCount: 3,
    });
    const taken = mergeRows(root, [fromEvent], false).get("r")?.thread;
    expect(taken).toMatchObject({ replyCount: 2, participating: false });
  });
});

describe("shown", () => {
  it("shows a live row and hides a tombstone", () => {
    expect(isShown(message("a"))).toBe(true);
    expect(isShown(message("a", { deleted: true }))).toBe(false);
  });

  it("shows a deleted root while its thread has replies", () => {
    const placeholder = message("a", {
      deleted: true,
      thread: { replyCount: 2 },
    });
    expect(isShown(placeholder)).toBe(true);
    expect(
      isShown(message("a", { deleted: true, thread: { replyCount: 0 } })),
    ).toBe(false);
  });

  it("lists a top-level row and a reply also sent to the channel", () => {
    expect(showsInChannel(message("a"))).toBe(true);
    expect(
      showsInChannel(message("a", { threadRootId: "r", inChannel: false })),
    ).toBe(false);
    expect(
      showsInChannel(message("a", { threadRootId: "r", inChannel: true })),
    ).toBe(true);
  });
});
