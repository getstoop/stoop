import { describe, expect, it } from "vitest";
import { withEvent } from "./events";
import { channelItems, threadItems } from "./items";
import { jumped, opened, paged } from "./pages";
import {
  CHANNEL,
  event,
  id,
  ids,
  message,
  openedOn,
  openedThread,
  page,
  rows,
} from "./testing";
import { emptyLog } from "./types";

describe("opened", () => {
  it("sets the range, the floor and, on an empty log, the seq", () => {
    const log = openedOn(rows(100, 150), { channelSeq: 150, floor: id(10) });
    expect(log.channel).toMatchObject({
      oldestId: id(100),
      newestId: id(149),
      hasOlder: true,
      hasNewer: false,
      generation: 1,
    });
    expect(log.seq).toBe(150);
    expect(log.floor).toBe(id(10));
    expect(ids(channelItems(log))).toEqual(ids(rows(100, 150)));
  });

  it("never moves the seq with a later page", () => {
    const log = openedOn(rows(100, 150), { channelSeq: 150 });
    const thread = openedThread(log, id(120), [], { channelSeq: 170 });
    expect(thread.seq).toBe(150);
    const again = opened(thread, {
      generation: 1,
      res: page(rows(100, 150), { channelSeq: 180 }),
    });
    expect(again.seq).toBe(150);
  });

  it("drops an answer under a stale generation", () => {
    const log = openedOn(rows(100, 150));
    const stale = opened(log, { generation: 0, res: page(rows(0, 50)) });
    expect(stale).toBe(log);
  });

  it("takes in a row that arrived while the page was out", () => {
    const early = withEvent(
      emptyLog(CHANNEL),
      event({ case: "messageCreated", value: message(id(150), { seq: 151n }) }),
    );
    const log = opened(early, {
      generation: 0,
      res: page(rows(100, 150), { channelSeq: 150 }),
    });
    expect(log.channel.newestId).toBe(id(150));
    expect(ids(channelItems(log))).toContain(id(150));
  });

  it("opens a thread as its own range beside the channel's", () => {
    const root = id(120);
    const log = openedThread(openedOn(rows(100, 150)), root, [
      message("r1", { threadRootId: root, inChannel: false }),
    ]);
    expect(log.threads[root]).toMatchObject({
      oldestId: "r1",
      newestId: "r1",
      hasOlder: false,
    });
    expect(ids(threadItems(log, root))).toEqual([root, "r1"]);
    expect(ids(channelItems(log))).not.toContain("r1");
  });
});

describe("paged", () => {
  it("grows the range over an older page", () => {
    const log = paged(openedOn(rows(100, 150)), "older", {
      generation: 1,
      res: page(rows(50, 100), { hasOlder: false }),
    });
    expect(log.channel).toMatchObject({
      oldestId: id(50),
      newestId: id(149),
      hasOlder: false,
    });
    expect(channelItems(log)).toHaveLength(100);
  });

  it("grows over a newer page and clears the pill on reaching the newest", () => {
    const back = openedOn(rows(100, 150), { hasNewer: true });
    const counted = withEvent(
      back,
      event({ case: "messageCreated", value: message(id(200), { seq: 151n }) }),
    );
    expect(counted.channel.pendingNewer).toBe(1);
    const log = paged(counted, "newer", {
      generation: 1,
      res: page(rows(150, 200), { hasNewer: false }),
    });
    expect(log.channel).toMatchObject({
      newestId: id(200),
      hasNewer: false,
      pendingNewer: 0,
    });
    expect(ids(channelItems(log))).toContain(id(200));
  });

  it("keeps the count while the newer page still stops short", () => {
    const back = withEvent(
      openedOn(rows(100, 150), { hasNewer: true }),
      event({ case: "messageCreated", value: message(id(300), { seq: 151n }) }),
    );
    const log = paged(back, "newer", {
      generation: 1,
      res: page(rows(150, 200), { hasNewer: true }),
    });
    expect(log.channel.pendingNewer).toBe(1);
  });

  it("drops a page under a stale generation", () => {
    const log = jumped(openedOn(rows(100, 150)), {
      generation: 1,
      res: page(rows(20, 70), { hasNewer: true }),
    });
    expect(log.channel.generation).toBe(2);
    const late = paged(log, "older", {
      generation: 1,
      res: page(rows(50, 100)),
    });
    expect(late).toBe(log);
  });

  it("does nothing for a thread that isn't open", () => {
    const log = openedOn(rows(100, 150));
    expect(
      paged(log, "older", { rootId: "none", generation: 0, res: page([]) }),
    ).toBe(log);
  });
});

describe("jumped", () => {
  it("replaces the range and starts the pill over", () => {
    const counted = withEvent(
      openedOn(rows(100, 150), { hasNewer: true }),
      event({ case: "messageCreated", value: message(id(300), { seq: 151n }) }),
    );
    const log = jumped(counted, {
      generation: 1,
      res: page(rows(20, 70), { hasNewer: true }),
    });
    expect(ids(channelItems(log))).toEqual(ids(rows(20, 70)));
    expect(log.channel.pendingNewer).toBe(0);
    // The rows left behind are still held: a jump back needs no refetch
    // of what the merge rule already knows.
    expect(log.rows.has(id(149))).toBe(true);
  });
});

describe("a page carrying a stale copy", () => {
  const edited = () =>
    withEvent(
      openedOn(rows(100, 150)),
      event({
        case: "messageUpdated",
        value: message(id(120), { content: "reworded", seq: 51n }),
      }),
    );
  const stale = () => message(id(120), { seq: 21n });

  it("keeps an edit over an older page", () => {
    const log = paged(edited(), "older", {
      generation: 1,
      res: page([...rows(50, 100), stale()]),
    });
    expect(log.rows.get(id(120))?.content).toBe("reworded");
  });

  it("keeps an edit over a new range", () => {
    const log = opened(edited(), {
      generation: 1,
      res: page([...rows(100, 120), stale(), ...rows(121, 150)]),
    });
    expect(log.rows.get(id(120))?.content).toBe("reworded");
    expect(channelItems(log).find((row) => row.id === id(120))?.content).toBe(
      "reworded",
    );
  });

  it("keeps a deletion over a page with the row", () => {
    const gone = withEvent(
      openedOn(rows(100, 150)),
      event({
        case: "messageDeleted",
        value: { channelId: CHANNEL, messageId: id(120), seq: 51n },
      }),
    );
    const log = paged(gone, "older", {
      generation: 1,
      res: page([...rows(50, 100), stale()]),
    });
    expect(log.rows.get(id(120))?.deleted).toBe(true);
    expect(ids(channelItems(log))).not.toContain(id(120));
  });
});
