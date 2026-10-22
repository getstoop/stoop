import { describe, expect, it } from "vitest";
import {
  FROM_ANSWER,
  FROM_EVENT,
  FROM_PAGE,
  isShown,
  mergeRows,
  showsInChannel,
} from "./rows";
import { message } from "./testing";

const held = new Map([["a", message("a", { content: "first", seq: 5n })]]);

describe("merge by seq", () => {
  it("replaces the held copy with a higher seq", () => {
    const merged = mergeRows(
      held,
      [message("a", { content: "second", seq: 6n })],
      FROM_EVENT,
    );
    expect(merged.get("a")?.content).toBe("second");
  });

  it("ignores an event's copy at an equal seq", () => {
    const merged = mergeRows(
      held,
      [message("a", { content: "other", seq: 5n })],
      FROM_EVENT,
    );
    expect(merged).toBe(held);
  });

  it("takes the server's copy at an equal seq", () => {
    const whole = message("a", { content: "whole", seq: 5n });
    expect(mergeRows(held, [whole], FROM_PAGE).get("a")).toBe(whole);
    expect(mergeRows(held, [whole], FROM_ANSWER).get("a")?.content).toBe(
      "whole",
    );
  });

  it("ignores a lower seq, from the server too", () => {
    const older = [message("a", { content: "older", seq: 4n })];
    expect(mergeRows(held, older, FROM_EVENT)).toBe(held);
    expect(mergeRows(held, older, FROM_PAGE)).toBe(held);
    expect(held.get("a")?.content).toBe("first");
  });

  it("adds a row it did not hold", () => {
    const merged = mergeRows(held, [message("b", { seq: 1n })], FROM_EVENT);
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
    const kept = mergeRows(root, [fromEvent], FROM_EVENT).get("r")?.thread;
    expect(kept).toMatchObject({
      replyCount: 2,
      participating: true,
      muted: true,
      unreadCount: 3,
    });
    const taken = mergeRows(root, [fromEvent], FROM_PAGE).get("r")?.thread;
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
