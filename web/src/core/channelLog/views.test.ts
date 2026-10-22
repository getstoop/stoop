import { describe, expect, it } from "vitest";
import { withArrivals } from "./arrivals";
import { channelItems, threadItems } from "./items";
import { FROM_ANSWER } from "./rows";
import { id, message, openedOn, openedThread, rows } from "./testing";
import { closedThread } from "./views";

// The channel's newest page is id(100) … id(199); id(50) lies older.
const channel = () => openedOn(rows(100, 200, 100));

const replies = (rootId: string) => [
  message("r1", { threadRootId: rootId, inChannel: false, seq: 300n }),
  message("r2", { threadRootId: rootId, inChannel: false, seq: 301n }),
];

describe("closedThread", () => {
  it("drops the view and its replies, keeping a root the channel shows", () => {
    const root = id(150);
    const log = openedThread(channel(), root, replies(root));
    const closed = closedThread(log, root);
    expect(closed.threads).toEqual({});
    expect(threadItems(closed, root)).toEqual([]);
    expect(closed.rows.has("r1")).toBe(false);
    expect(closed.rows.has("r2")).toBe(false);
    expect(closed.rows.has(root)).toBe(true);
    expect(channelItems(closed)).toEqual(channelItems(log));
  });

  it("drops a root held for the thread alone", () => {
    const root = id(50);
    const held = withArrivals(
      channel(),
      [message(root, { seq: 50n })],
      FROM_ANSWER,
    );
    const log = openedThread(held, root, replies(root));
    expect(log.rows.has(root)).toBe(true);
    const closed = closedThread(log, root);
    expect(closed.rows.has(root)).toBe(false);
    expect(closed.rows.has("r1")).toBe(false);
    expect(channelItems(closed)).toHaveLength(100);
  });

  it("keeps a reply the channel's range also lists", () => {
    const root = id(150);
    const also = message("m00150-also", {
      threadRootId: root,
      inChannel: true,
      seq: 302n,
    });
    const log = openedThread(channel(), root, [...replies(root), also]);
    const closed = closedThread(log, root);
    expect(closed.rows.has(also.id)).toBe(true);
    expect(closed.rows.has("r1")).toBe(false);
  });

  it("leaves a log without the thread as it is", () => {
    const log = channel();
    expect(closedThread(log, id(150))).toBe(log);
  });
});
