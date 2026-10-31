import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { type ActivityItem, ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { deletionMayClearActivity, olderAfterLoad, olderAfterRead } from "./feed";

const stamp = (seconds: number): Timestamp =>
  ({ $typeName: "google.protobuf.Timestamp", seconds: BigInt(seconds), nanos: 0 }) as Timestamp;

const item = (id: string, read = false): ActivityItem =>
  ({
    id,
    kind: ActivityKind.MENTION,
    spaceId: "s1",
    channelId: "general",
    messageId: `m-${id}`,
    preview: "",
    muted: false,
    readAt: read ? stamp(1) : undefined,
  }) as ActivityItem;

const unread = (items: ActivityItem[]) => items.filter((x) => !x.readAt).map((x) => x.id);

describe("olderAfterRead", () => {
  it("stamps the given older items", () => {
    expect(unread(olderAfterRead([item("b"), item("a")], ["a"], stamp(9)))).toEqual(["b"]);
  });

  it("stamps all of them for Mark all read", () => {
    expect(unread(olderAfterRead([item("b"), item("a")], "all", stamp(9)))).toEqual([]);
  });
});

describe("olderAfterLoad", () => {
  it("reads the older rows when the server counts nothing unread past the first page", () => {
    const first = { items: [item("d"), item("c", true)], unreadCount: 1 };
    expect(unread(olderAfterLoad([item("b"), item("a")], first, stamp(9)))).toEqual([]);
  });

  it("leaves them when the server counts more unread than the first page shows", () => {
    const first = { items: [item("d"), item("c", true)], unreadCount: 3 };
    expect(unread(olderAfterLoad([item("b"), item("a")], first, stamp(9)))).toEqual(["b", "a"]);
  });

  it("hands back the same pages when nothing older is unread", () => {
    const older = [item("a", true)];
    expect(olderAfterLoad(older, { items: [], unreadCount: 0 }, stamp(9))).toBe(older);
  });
});

describe("deletionMayClearActivity", () => {
  const data = { items: [item("b"), item("a", true)], unreadCount: 1 };

  it("is true for a message an item in the first page is for", () => {
    expect(deletionMayClearActivity(data, [], "m-a")).toBe(true);
  });

  it("is true for one an older item is for", () => {
    expect(deletionMayClearActivity(data, [item("z", true)], "m-z")).toBe(true);
  });

  it("is false for another message when nothing unread is past the first page", () => {
    expect(deletionMayClearActivity(data, [], "m-q")).toBe(false);
  });

  it("is true when the server counts unread past the first page", () => {
    expect(deletionMayClearActivity({ ...data, unreadCount: 4 }, [], "m-q")).toBe(true);
  });
});
