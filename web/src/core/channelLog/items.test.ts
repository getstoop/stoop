import { describe, expect, it } from "vitest";
import { withEvent } from "./events";
import { channelItems, isLive, pendingNewer, threadItems } from "./items";
import {
  CHANNEL,
  event,
  id,
  ids,
  message,
  openedOn,
  openedThread,
  rows,
} from "./testing";
import { emptyView } from "./types";

const root = id(3);
// Replies sort after their root, as UUIDv7 ids do.
const inThread = `${root}-r1`;
const inBoth = `${root}-r2`;
const mixed = () =>
  openedOn(
    [
      ...rows(0, 3),
      message(root, { seq: 4n, deleted: true, thread: { replyCount: 2 } }),
      message(id(4), { seq: 5n, deleted: true }),
      message(inThread, { seq: 6n, threadRootId: root, inChannel: false }),
      message(inBoth, { seq: 7n, threadRootId: root, inChannel: true }),
      ...rows(5, 8, 8),
    ],
    { hasOlder: false },
  );

describe("channel items", () => {
  it("lists shown rows in id order: placeholder roots in, hidden tombstones and thread-only replies out", () => {
    expect(ids(channelItems(mixed()))).toEqual([
      id(0),
      id(1),
      id(2),
      root,
      inBoth,
      id(5),
      id(6),
      id(7),
    ]);
  });

  it("lists only the range", () => {
    const log = withEvent(
      openedOn(rows(0, 10), { hasNewer: true }),
      event({ case: "messageCreated", value: message(id(20), { seq: 11n }) }),
    );
    expect(ids(channelItems(log))).toEqual(ids(rows(0, 10)));
  });

  it("hands back the same array while its rows and drafts are unchanged", () => {
    const log = mixed();
    const first = channelItems(log);
    expect(channelItems(log)).toBe(first);
    const withThread = openedThread(log, root, []);
    expect(channelItems(withThread)).toBe(first);
    const changed = withEvent(
      withThread,
      event({ case: "messageCreated", value: message(id(8), { seq: 12n }) }),
    );
    expect(channelItems(changed)).not.toBe(first);
  });
});

describe("thread items", () => {
  it("lists the root and the replies in its range", () => {
    const log = openedThread(mixed(), root, [
      message(inThread, { seq: 6n, threadRootId: root, inChannel: false }),
      message(inBoth, { seq: 7n, threadRootId: root, inChannel: true }),
    ]);
    expect(ids(threadItems(log, root))).toEqual([root, inThread, inBoth]);
  });

  it("is empty for a thread that isn't open", () => {
    expect(threadItems(mixed(), root)).toEqual([]);
    expect(threadItems(mixed(), root)).toBe(threadItems(mixed(), "other"));
  });

  it("leaves out a root that is hidden", () => {
    const hiddenRoot = id(4);
    const log = openedThread(mixed(), hiddenRoot, []);
    expect(threadItems(log, hiddenRoot)).toEqual([]);
    expect(log.channelId).toBe(CHANNEL);
  });
});

describe("a view's flags", () => {
  it("is live when nothing newer lies beyond, and counts what arrived beyond", () => {
    expect(isLive(emptyView)).toBe(false);
    expect(isLive({ ...emptyView, hasNewer: false })).toBe(true);
    expect(pendingNewer({ ...emptyView, pendingNewer: 3 })).toBe(3);
  });
});
