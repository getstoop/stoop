import { describe, expect, it } from "vitest";
import { withEvent } from "./events";
import { channelItems, threadItems } from "./items";
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
import { emptyLog } from "./types";

// A live channel view over id(0) … id(9) at seq 10.
const live = () => openedOn(rows(0, 10), { hasOlder: false });

const created = (rowId: string, seq: number, init = {}) =>
  event({
    case: "messageCreated",
    value: message(rowId, { seq: BigInt(seq), ...init }),
  });
const deleted = (rowId: string, seq: number, threadRootId = "") =>
  event({
    case: "messageDeleted",
    value: {
      channelId: CHANNEL,
      messageId: rowId,
      threadRootId,
      seq: BigInt(seq),
    },
  });

describe("the position", () => {
  it("advances on the next seq", () => {
    const log = withEvent(live(), created(id(10), 11));
    expect(log.seq).toBe(11);
    expect(log.needsCatchUp).toBe(false);
    expect(ids(channelItems(log))).toContain(id(10));
  });

  it("applies a seq further on and marks the gap", () => {
    const log = withEvent(live(), created(id(10), 13));
    expect(ids(channelItems(log))).toContain(id(10));
    expect(log.seq).toBe(10);
    expect(log.needsCatchUp).toBe(true);
  });

  it("ignores a seq at or below what is known", () => {
    const log = live();
    const edit = event({
      case: "messageUpdated",
      value: message(id(3), { content: "reworded", seq: 10n }),
    });
    expect(withEvent(log, edit)).toBe(log);
  });

  it("keeps rows before the first page without judging the gap", () => {
    const log = withEvent(emptyLog(CHANNEL), created(id(0), 40));
    expect(log.seq).toBe(0);
    expect(log.needsCatchUp).toBe(false);
    expect(log.rows.has(id(0))).toBe(true);
  });

  it("ignores another channel's event", () => {
    const log = live();
    expect(withEvent(log, created("x", 11, { channelId: "c2" }))).toBe(log);
  });
});

describe("each kind", () => {
  it("replaces reactions at the event's seq", () => {
    const log = withEvent(
      live(),
      event({
        case: "reactionsChanged",
        value: {
          channelId: CHANNEL,
          messageId: id(3),
          reactions: [{ emoji: "👍", userIds: ["them"] }],
          seq: 11n,
        },
      }),
    );
    const row = log.rows.get(id(3));
    expect(row?.reactions.map((reaction) => reaction.emoji)).toEqual(["👍"]);
    expect(row?.seq).toBe(11n);
    expect(log.seq).toBe(11);
  });

  it("sets pinned", () => {
    const log = withEvent(
      live(),
      event({
        case: "messagePinned",
        value: { channelId: CHANNEL, messageId: id(3), pinned: true, seq: 11n },
      }),
    );
    expect(log.rows.get(id(3))?.pinned).toBe(true);
  });

  it("sets the thread summary, keeping the reader's half", () => {
    const root = message(id(3), {
      seq: 4n,
      thread: { replyCount: 1, participating: true, unreadCount: 1 },
    });
    const log = withEvent(
      openedOn([...rows(0, 3), root, ...rows(4, 10, 5)], { hasOlder: false }),
      event({
        case: "threadChanged",
        value: {
          channelId: CHANNEL,
          rootMessageId: id(3),
          thread: { replyCount: 2 },
          seq: 11n,
        },
      }),
    );
    expect(log.rows.get(id(3))?.thread).toMatchObject({
      replyCount: 2,
      participating: true,
      unreadCount: 1,
    });
  });

  it("turns a deletion into a hidden tombstone and blanks quotes of it", () => {
    const quoting = message(id(9), {
      seq: 10n,
      replyTo: { messageId: id(3), author: { id: "them" }, preview: "hi" },
    });
    const log = withEvent(
      openedOn([...rows(0, 9), quoting], { hasOlder: false }),
      deleted(id(3), 11),
    );
    const tomb = log.rows.get(id(3));
    expect(tomb).toMatchObject({ deleted: true, content: "", seq: 11n });
    expect(ids(channelItems(log))).not.toContain(id(3));
    expect(log.rows.get(id(9))?.replyTo).toMatchObject({
      author: undefined,
      preview: "",
    });
  });

  it("keeps a tombstone for a row it never held", () => {
    const log = withEvent(live(), deleted("never", 11));
    expect(log.rows.get("never")?.deleted).toBe(true);
    expect(log.seq).toBe(11);
  });

  it("does not resurrect a tombstone with a stale copy", () => {
    const log = withEvent(live(), deleted(id(3), 11));
    const stale = event({
      case: "messageUpdated",
      value: message(id(3), { content: "back", seq: 9n }),
    });
    // The event's seq is already known, so it is ignored outright …
    expect(withEvent(log, stale)).toBe(log);
    // … and a catch-up's copy below the tombstone's seq would be too.
    const laterGap = withEvent(log, created(id(10), 13));
    expect(laterGap.rows.get(id(3))?.deleted).toBe(true);
  });

  it("shows a root deleted while its thread has replies as a placeholder", () => {
    const log = withEvent(
      live(),
      event({
        case: "messageUpdated",
        value: message(id(3), {
          deleted: true,
          content: "",
          seq: 11n,
          thread: { replyCount: 2 },
        }),
      }),
    );
    expect(ids(channelItems(log))).toContain(id(3));
  });
});

describe("a created row and the views", () => {
  it("extends a live range", () => {
    const log = withEvent(live(), created(id(10), 11));
    expect(log.channel.newestId).toBe(id(10));
    expect(log.channel.pendingNewer).toBe(0);
  });

  it("counts on the pill beyond a range that stops short", () => {
    const log = withEvent(
      openedOn(rows(0, 10), { hasNewer: true }),
      created(id(20), 11),
    );
    expect(log.channel.pendingNewer).toBe(1);
    expect(log.channel.newestId).toBe(id(9));
    expect(ids(channelItems(log))).not.toContain(id(20));
    expect(log.rows.has(id(20))).toBe(true);
  });

  it("reaches an open thread, and the channel when also sent there", () => {
    const root = id(3);
    const withThread = openedThread(live(), root, [], { hasNewer: false });
    const reply = created("reply", 11, {
      threadRootId: root,
      inChannel: false,
    });
    const inThread = withEvent(withThread, reply);
    expect(ids(threadItems(inThread, root))).toEqual([root, "reply"]);
    expect(ids(channelItems(inThread))).not.toContain("reply");
    const both = withEvent(
      withThread,
      created("reply2", 11, { threadRootId: root, inChannel: true }),
    );
    expect(ids(threadItems(both, root))).toEqual([root, "reply2"]);
    expect(ids(channelItems(both))).toContain("reply2");
  });

  it("counts on a thread's pill when its range stops short", () => {
    const root = id(3);
    const withThread = openedThread(
      live(),
      root,
      [message("r1", { threadRootId: root, inChannel: false })],
      { hasNewer: true },
    );
    const log = withEvent(
      withThread,
      created("r2", 11, { threadRootId: root, inChannel: false }),
    );
    expect(log.threads[root].pendingNewer).toBe(1);
  });
});
