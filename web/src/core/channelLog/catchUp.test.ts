import { describe, expect, it } from "vitest";
import { caughtUp, nextSince, reconnected } from "./catchUp";
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
