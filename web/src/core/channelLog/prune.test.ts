import { describe, expect, it } from "vitest";
import { withEvent } from "./events";
import { channelItems, threadItems } from "./items";
import { paged } from "./pages";
import {
  event,
  id,
  message,
  openedOn,
  openedThread,
  page,
  rows,
} from "./testing";
import { LOG_CAP } from "./types";

// The newest page sits at id(5000) … id(5099); older pages reach back.
const newest = () => openedOn(rows(5000, 5100, 5000));

describe("prune", () => {
  it("paging older past the cap drops the newest rows and the view stops being live", () => {
    const log = paged(newest(), "older", {
      generation: 1,
      res: page(rows(5100 - LOG_CAP - 50, 5000)),
    });
    const items = channelItems(log);
    expect(items).toHaveLength(LOG_CAP);
    expect(items[0].id).toBe(id(5100 - LOG_CAP - 50));
    expect(items[items.length - 1].id).toBe(id(5049));
    expect(log.channel).toMatchObject({ newestId: id(5049), hasNewer: true });
    expect(log.rows.has(id(5099))).toBe(false);
  });

  it("paging newer past the cap drops the oldest rows", () => {
    const back = openedOn(rows(0, LOG_CAP), {
      hasNewer: true,
      hasOlder: false,
    });
    const log = paged(back, "newer", {
      generation: 1,
      res: page(rows(LOG_CAP, LOG_CAP + 50), { hasNewer: true }),
    });
    expect(channelItems(log)).toHaveLength(LOG_CAP);
    expect(log.channel).toMatchObject({
      oldestId: id(50),
      hasOlder: true,
      hasNewer: true,
    });
    expect(log.rows.has(id(0))).toBe(false);
  });

  it("a live arrival past the cap drops the oldest row", () => {
    const full = openedOn(rows(0, LOG_CAP, 1), { hasOlder: false });
    const log = withEvent(
      full,
      event({
        case: "messageCreated",
        value: message(id(LOG_CAP), { seq: BigInt(LOG_CAP + 1) }),
      }),
    );
    expect(channelItems(log)).toHaveLength(LOG_CAP);
    expect(log.channel).toMatchObject({
      oldestId: id(1),
      newestId: id(LOG_CAP),
      hasOlder: true,
    });
    expect(log.rows.has(id(0))).toBe(false);
  });

  it("keeps a dropped row that an open thread still lists", () => {
    const root = id(5099);
    const withThread = openedThread(newest(), root, [
      message("r1", { threadRootId: root, inChannel: true, seq: 6000n }),
    ]);
    const log = paged(withThread, "older", {
      generation: 1,
      res: page(rows(5100 - LOG_CAP - 50, 5000)),
    });
    expect(log.rows.has(root)).toBe(true);
    expect(log.rows.has("r1")).toBe(true);
    expect(log.rows.has(id(5098))).toBe(false);
    expect(threadItems(log, root).map((row) => row.id)).toEqual([root, "r1"]);
  });
});
