import { describe, expect, it } from "vitest";
import { withThreadOverlay } from "./overlay";
import { id, message, openedOn, rows } from "./testing";

const root = id(3);
const held = () =>
  openedOn(
    [
      ...rows(0, 3),
      message(root, {
        seq: 4n,
        thread: { replyCount: 2, participating: false, unreadCount: 2 },
      }),
      ...rows(4, 10, 5),
    ],
    { hasOlder: false },
  );

describe("the thread overlay", () => {
  it("patches the reader's half of a held root's summary at the held seq", () => {
    const log = withThreadOverlay(held(), root, {
      participating: true,
      unreadCount: 0,
    });
    expect(log.rows.get(root)?.thread).toMatchObject({
      replyCount: 2,
      participating: true,
      unreadCount: 0,
    });
    expect(log.rows.get(root)?.seq).toBe(4n);
    expect(log.seq).toBe(10);
  });

  it("changes nothing for a root that isn't held, has no summary, or already reads so", () => {
    const log = held();
    expect(withThreadOverlay(log, "none", { muted: true })).toBe(log);
    expect(withThreadOverlay(log, id(1), { muted: true })).toBe(log);
    expect(withThreadOverlay(log, root, { unreadCount: 2 })).toBe(log);
  });
});
