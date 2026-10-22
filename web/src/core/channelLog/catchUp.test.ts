import { describe, expect, it } from "vitest";
import { caughtUp, nextSince, reconnected, refreshed } from "./catchUp";
import { withEvent } from "./events";
import { channelItems } from "./items";
import {
  CHANNEL,
  changes,
  event,
  id,
  ids,
  message,
  openedOn,
  page,
  rows,
} from "./testing";

// A live view over id(0) … id(9) at seq 10, with a gap seen at seq 13.
const gapped = () =>
  withEvent(
    openedOn(rows(0, 10), { hasOlder: false }),
    event({ case: "messageCreated", value: message(id(12), { seq: 13n }) }),
  );

describe("caught up", () => {
  it("merges the missed rows and settles the position on the last page", () => {
    const log = caughtUp(
      gapped(),
      changes(
        [
          message(id(10), { seq: 11n }),
          message(id(3), { content: "reworded", seq: 12n }),
          message(id(12), { seq: 13n }),
        ],
        { channelSeq: 13 },
      ),
    );
    expect(ids(channelItems(log))).toEqual([
      ...ids(rows(0, 10)),
      id(10),
      id(12),
    ]);
    expect(log.rows.get(id(3))?.content).toBe("reworded");
    expect(log.seq).toBe(13);
    expect(log.needsCatchUp).toBe(false);
  });

  it("holds the position while there is more, and continues from the last row", () => {
    const first = changes([message(id(10), { seq: 11n })], {
      hasMore: true,
      channelSeq: 13,
    });
    const log = caughtUp(gapped(), first);
    expect(log.seq).toBe(10);
    expect(log.needsCatchUp).toBe(true);
    expect(nextSince(10, first)).toBe(11);
    expect(nextSince(10, changes([]))).toBe(10);
  });

  it("stays owed while an event seen lies above the settled position", () => {
    // The pass was out through seq 13 when 15 arrived (14 missed): the
    // last page settles on 13, and the catch-up is still owed from there.
    const during = withEvent(
      gapped(),
      event({ case: "messageCreated", value: message(id(14), { seq: 15n }) }),
    );
    const log = caughtUp(
      during,
      changes([message(id(10), { seq: 11n }), message(id(12), { seq: 13n })], {
        channelSeq: 13,
      }),
    );
    expect(log.seq).toBe(13);
    expect(log.needsCatchUp).toBe(true);
    const next = caughtUp(
      log,
      changes([message(id(13), { seq: 14n }), message(id(14), { seq: 15n })], {
        channelSeq: 15,
      }),
    );
    expect(next.seq).toBe(15);
    expect(next.needsCatchUp).toBe(false);
    expect(ids(channelItems(next))).toEqual([
      ...ids(rows(0, 10)),
      id(10),
      id(12),
      id(13),
      id(14),
    ]);
  });

  it("repairs a row a partial event stamped over an edit the socket missed", () => {
    // The edit at 11 never came; the reaction at 12 patched the held row
    // (old content) to seq 12. The catch-up's whole row at 12 is the
    // server's and wins the tie.
    const reacted = withEvent(
      openedOn(rows(0, 10), { hasOlder: false }),
      event({
        case: "reactionsChanged",
        value: {
          channelId: CHANNEL,
          messageId: id(3),
          reactions: [{ emoji: "👍", userIds: ["them"] }],
          seq: 12n,
        },
      }),
    );
    expect(reacted.rows.get(id(3))).toMatchObject({ content: id(3), seq: 12n });
    expect(reacted.needsCatchUp).toBe(true);
    const log = caughtUp(
      reacted,
      changes(
        [
          message(id(3), {
            content: "reworded",
            reactions: [{ emoji: "👍", userIds: ["them"] }],
            seq: 12n,
          }),
        ],
        { channelSeq: 12 },
      ),
    );
    expect(log.rows.get(id(3))).toMatchObject({
      content: "reworded",
      seq: 12n,
    });
    expect(log.rows.get(id(3))?.reactions).toHaveLength(1);
    expect(log.seq).toBe(12);
    expect(log.needsCatchUp).toBe(false);
    // An event's copy at the same seq is still nothing new.
    expect(
      withEvent(
        log,
        event({
          case: "messageUpdated",
          value: message(id(3), { content: "stale", seq: 12n }),
        }),
      ),
    ).toBe(log);
  });

  it("takes the highest row seq over a lower channel seq", () => {
    const log = caughtUp(
      gapped(),
      changes([message(id(10), { seq: 11n }), message(id(12), { seq: 14n })], {
        channelSeq: 13,
      }),
    );
    expect(log.seq).toBe(14);
  });

  it("applies a tombstone and keeps the higher held copy", () => {
    const log = caughtUp(
      gapped(),
      changes(
        [
          message(id(3), { deleted: true, content: "", seq: 11n }),
          message(id(12), { content: "stale", seq: 12n }),
        ],
        { channelSeq: 13 },
      ),
    );
    expect(ids(channelItems(log))).not.toContain(id(3));
    expect(log.rows.get(id(12))?.content).toBe(id(12));
  });

  it("counts a new row beyond a range that stops short, and shows one inside a live range", () => {
    const back = openedOn(rows(0, 10), { hasNewer: true });
    const counted = caughtUp(
      { ...back, needsCatchUp: true },
      changes([message(id(20), { seq: 11n })], { channelSeq: 11 }),
    );
    expect(counted.channel.pendingNewer).toBe(1);
    expect(ids(channelItems(counted))).not.toContain(id(20));
    const live = caughtUp(
      { ...openedOn(rows(0, 10)), needsCatchUp: true },
      changes([message(id(20), { seq: 11n })], { channelSeq: 11 }),
    );
    expect(ids(channelItems(live))).toContain(id(20));
  });
});

describe("refreshed", () => {
  it("takes the reader's half from the newest page at the same seq, moving nothing else", () => {
    const root = message(id(3), {
      seq: 4n,
      thread: { replyCount: 1, participating: true, unreadCount: 2 },
    });
    const log = openedOn([...rows(0, 3), root, ...rows(4, 10, 5)], {
      hasOlder: false,
    });
    const read = message(id(3), {
      seq: 4n,
      thread: { replyCount: 1, participating: true, unreadCount: 0 },
    });
    const next = refreshed(log, page([...rows(0, 3), read, ...rows(4, 10, 5)]));
    expect(next.rows.get(id(3))?.thread?.unreadCount).toBe(0);
    expect(next.seq).toBe(log.seq);
    expect(next.channel).toBe(log.channel);
    expect(next.needsCatchUp).toBe(false);
  });
});

describe("reconnected", () => {
  it("owes a catch-up and drops nothing", () => {
    const log = reconnected(openedOn(rows(0, 10)));
    expect(log.needsCatchUp).toBe(true);
    expect(log.seq).toBe(10);
    expect(channelItems(log)).toHaveLength(10);
    expect(reconnected(log)).toBe(log);
    expect(log.channelId).toBe(CHANNEL);
  });
});

describe("events out of order", () => {
  it("are settled by the catch-up", () => {
    const later = withEvent(
      openedOn(rows(0, 10), { hasOlder: false }),
      event({ case: "messageCreated", value: message(id(11), { seq: 12n }) }),
    );
    expect(later.needsCatchUp).toBe(true);
    const earlier = withEvent(
      later,
      event({ case: "messageCreated", value: message(id(10), { seq: 11n }) }),
    );
    expect(earlier.seq).toBe(11);
    expect(earlier.needsCatchUp).toBe(true);
    const log = caughtUp(
      earlier,
      changes([message(id(10), { seq: 11n }), message(id(11), { seq: 12n })], {
        channelSeq: 12,
      }),
    );
    expect(log.seq).toBe(12);
    expect(log.needsCatchUp).toBe(false);
    expect(ids(channelItems(log))).toEqual([
      ...ids(rows(0, 10)),
      id(10),
      id(11),
    ]);
  });
});
