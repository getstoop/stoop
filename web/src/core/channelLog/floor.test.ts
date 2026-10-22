import { describe, expect, it } from "vitest";
import { caughtUp } from "./catchUp";
import { channelItems, threadItems } from "./items";
import { paged } from "./pages";
import {
  changes,
  id,
  ids,
  message,
  openedOn,
  openedThread,
  page,
  rows,
} from "./testing";

// Two roots below the floor, one pinned, each with a reply; a reply whose
// root is not held; the floor at id(50).
const swept = id(10);
const kept = id(20);
const orphan = "orphan";
const held = () =>
  openedThread(
    openedThread(
      openedOn(
        [
          message(swept, { seq: 1n, thread: { replyCount: 1 } }),
          message(kept, { seq: 2n, pinned: true, thread: { replyCount: 1 } }),
          message("s1", { seq: 3n, threadRootId: swept, inChannel: true }),
          message("k1", { seq: 4n, threadRootId: kept, inChannel: true }),
          message(orphan, { seq: 5n, threadRootId: id(30), inChannel: true }),
          ...rows(100, 110, 6),
        ],
        { hasOlder: false },
      ),
      swept,
      [message("s1", { seq: 3n, threadRootId: swept, inChannel: true })],
    ),
    kept,
    [message("k1", { seq: 4n, threadRootId: kept, inChannel: true })],
  );

const expectSwept = (log: ReturnType<typeof held>) => {
  const shown = ids(channelItems(log));
  expect(shown).not.toContain(swept);
  expect(shown).not.toContain("s1");
  expect(shown).toContain(kept);
  expect(shown).toContain("k1");
  expect(shown).toContain(orphan);
  expect(log.rows.has(swept)).toBe(false);
  expect(log.floor).toBe(id(50));
  expect(log.threads[swept]).toBeUndefined();
  expect(ids(threadItems(log, kept))).toEqual([kept, "k1"]);
};

describe("the retention floor", () => {
  it("on a load drops unpinned rows below it and the replies under a swept root", () => {
    expectSwept(
      paged(held(), "older", {
        generation: 1,
        res: page([], { hasOlder: false, floor: id(50) }),
      }),
    );
  });

  it("on a catch-up does the same", () => {
    expectSwept(
      caughtUp(held(), changes([], { channelSeq: 15, floor: id(50) })),
    );
  });

  it("never moves back", () => {
    const log = caughtUp(
      held(),
      changes([], { channelSeq: 15, floor: id(50) }),
    );
    expect(caughtUp(log, changes([], { channelSeq: 15, floor: id(40) }))).toBe(
      log,
    );
  });

  it("leaves a log alone with retention off", () => {
    const log = held();
    expect(caughtUp(log, changes([], { channelSeq: 15 }))).toBe(log);
  });
});
