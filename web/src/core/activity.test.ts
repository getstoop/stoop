import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  type ActivityItem,
  ActivityKind,
} from "../gen/stoop/chat/v1/activity_pb";
import {
  type ActivityData,
  activityTime,
  activityVerb,
  alertingCount,
  readMayClearActivity,
  startsDay,
  unreadCounts,
  withActivityItem,
  withActivityRead,
  withOlderPages,
} from "./activity";

const stamp = (seconds: number): Timestamp =>
  ({
    $typeName: "google.protobuf.Timestamp",
    seconds: BigInt(seconds),
    nanos: 0,
  }) as Timestamp;

const item = (id: string, over: Partial<ActivityItem> = {}): ActivityItem =>
  ({
    id,
    kind: ActivityKind.MENTION,
    spaceId: "s1",
    channelId: "general",
    messageId: `m-${id}`,
    preview: "",
    muted: false,
    ...over,
  }) as ActivityItem;

const data = (
  items: ActivityItem[],
  unreadCount = items.length,
): ActivityData => ({ items, unreadCount });

describe("activityVerb", () => {
  it("names each kind", () => {
    expect(activityVerb(ActivityKind.MENTION)).toBe("mentioned you");
    expect(activityVerb(ActivityKind.REPLY)).toBe("replied to you");
    expect(activityVerb(ActivityKind.DM)).toBe("sent you a direct message");
    expect(activityVerb(ActivityKind.THREAD_REPLY)).toBe("replied in a thread");
  });

  // A kind this build does not know about still reads as something that
  // happened to you rather than as a blank.
  it("falls back to a mention", () => {
    expect(activityVerb(ActivityKind.UNSPECIFIED)).toBe("mentioned you");
    expect(activityVerb(99 as ActivityKind)).toBe("mentioned you");
  });
});

describe("unreadCounts", () => {
  it("is empty when nothing is loaded", () => {
    const { bySpace, byChannel } = unreadCounts(undefined);
    expect(bySpace.size).toBe(0);
    expect(byChannel.size).toBe(0);
  });

  it("groups unread items by space and by channel", () => {
    const { bySpace, byChannel } = unreadCounts(
      data([
        item("1"),
        item("2", { channelId: "random" }),
        item("3", { spaceId: "s2", channelId: "welcome" }),
      ]),
    );
    expect([...bySpace]).toEqual([
      ["s1", 2],
      ["s2", 1],
    ]);
    expect([...byChannel]).toEqual([
      ["general", 1],
      ["random", 1],
      ["welcome", 1],
    ]);
  });

  it("leaves out thread replies but counts a mention in a thread", () => {
    const { byChannel } = unreadCounts(
      data([
        item("1", { kind: ActivityKind.THREAD_REPLY, threadRootId: "r" }),
        item("2", { threadRootId: "r" }),
      ]),
    );
    expect(byChannel.get("general")).toBe(1);
  });

  it("skips items already read", () => {
    const { bySpace } = unreadCounts(
      data([item("1", { readAt: stamp(10) }), item("2")]),
    );
    expect(bySpace.get("s1")).toBe(1);
  });

  it("skips items the server stamped muted", () => {
    const { bySpace, byChannel } = unreadCounts(
      data([item("1", { muted: true })]),
    );
    expect(bySpace.size).toBe(0);
    expect(byChannel.size).toBe(0);
  });

  // A direct message carries no space, so its count lands under the empty
  // key rather than a real space's.
  it("keys direct messages under the empty space", () => {
    const { bySpace, byChannel } = unreadCounts(
      data([
        item("1", { kind: ActivityKind.DM, spaceId: "", channelId: "ada" }),
      ]),
    );
    expect(bySpace.get("")).toBe(1);
    expect(byChannel.get("ada")).toBe(1);
  });
});

describe("alertingCount", () => {
  it("is zero when nothing is loaded", () => {
    expect(alertingCount(undefined)).toBe(0);
  });

  it("totals the unread, unmuted items across spaces and direct messages", () => {
    expect(
      alertingCount(
        data([
          item("1"),
          item("2", { spaceId: "s2" }),
          item("3", { kind: ActivityKind.DM, spaceId: "", channelId: "bea" }),
          item("4", { muted: true }),
          item("5", { readAt: stamp(10) }),
        ]),
      ),
    ).toBe(3);
  });
});

describe("readMayClearActivity", () => {
  const read = { readAt: stamp(1) };

  it("is false with nothing cached", () => {
    expect(readMayClearActivity(undefined, { channelId: "general" })).toBe(
      false,
    );
  });

  it("is true for an unread item in the channel read", () => {
    const cached = data([item("a"), item("b", { channelId: "random" })]);
    expect(readMayClearActivity(cached, { channelId: "general" })).toBe(true);
    expect(readMayClearActivity(cached, { channelId: "garden" })).toBe(false);
  });

  // The count includes muted items too; it is the cached rows that
  // decide, unless the server counts more unread than the cache holds.
  it("ignores read items and other channels while the cache holds every unread", () => {
    const cached = data(
      [item("a", read), item("b", { channelId: "random" })],
      1,
    );
    expect(readMayClearActivity(cached, { channelId: "general" })).toBe(false);
  });

  it("is true when unread items lie past the cached page", () => {
    const cached = data([item("a", { channelId: "random" })], 60);
    expect(readMayClearActivity(cached, { channelId: "general" })).toBe(true);
  });

  it("matches a thread read by its root", () => {
    const cached = data([item("a", { threadRootId: "root1" })]);
    expect(readMayClearActivity(cached, { threadRootId: "root1" })).toBe(true);
    expect(readMayClearActivity(cached, { threadRootId: "root2" })).toBe(false);
  });
});

describe("withActivityItem", () => {
  it("puts a new item on top and counts it", () => {
    const next = withActivityItem(data([item("1")], 1), item("2"));
    expect(next.items.map((x) => x.id)).toEqual(["2", "1"]);
    expect(next.unreadCount).toBe(2);
  });

  it("does not count an item that arrives already read", () => {
    const next = withActivityItem(
      data([item("1")], 1),
      item("2", { readAt: stamp(10) }),
    );
    expect(next.unreadCount).toBe(1);
  });

  // The same object back, so a holder can tell nothing changed.
  it("hands back the same feed for a replay of a known mention", () => {
    const feed = data([item("1"), item("2")], 2);
    expect(withActivityItem(feed, item("1", { preview: "edited" }))).toBe(feed);
  });

  const dmItem = (over: Partial<ActivityItem> = {}) =>
    item("dm-ada", {
      kind: ActivityKind.DM,
      spaceId: "",
      channelId: "ada",
      ...over,
    });

  it("refreshes an unread direct message in place without double counting", () => {
    const next = withActivityItem(
      data([item("1"), dmItem({ preview: "hi" })], 2),
      dmItem({ preview: "you there?" }),
    );
    expect(next.items.map((x) => x.id)).toEqual(["dm-ada", "1"]);
    expect(next.items[0].preview).toBe("you there?");
    expect(next.unreadCount).toBe(2);
  });

  it("counts a direct message that goes unread again after being read", () => {
    const next = withActivityItem(
      data([dmItem({ readAt: stamp(10) })], 0),
      dmItem({ preview: "back" }),
    );
    expect(next.items[0].readAt).toBeUndefined();
    expect(next.unreadCount).toBe(1);
  });
});

describe("withActivityRead", () => {
  it("stamps the named unread items and takes the server's count", () => {
    const next = withActivityRead(
      data([item("1"), item("2"), item("3")], 7),
      ["1", "3"],
      5,
      stamp(20),
    );
    expect(next.items.map((x) => x.readAt?.seconds)).toEqual([
      20n,
      undefined,
      20n,
    ]);
    expect(next.unreadCount).toBe(5);
  });

  it("stamps every unread item for all, and keeps an earlier stamp", () => {
    const next = withActivityRead(
      data([item("1", { readAt: stamp(5) }), item("2")], 1),
      "all",
      0,
      stamp(20),
    );
    expect(next.items.map((x) => x.readAt?.seconds)).toEqual([5n, 20n]);
    expect(next.unreadCount).toBe(0);
  });
});

describe("activityTime", () => {
  const now = new Date(2026, 9, 30, 15, 0);
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("says how long ago within a day", () => {
    expect(activityTime(ago(20), true, now)).toBe("just now");
    expect(activityTime(ago(3 * 60), true, now)).toBe("3m ago");
    expect(activityTime(ago(2 * 3600), false, now)).toBe("2h ago");
  });

  it("past a day, carries the date only when dated", () => {
    const old = new Date(2026, 9, 27, 9, 5);
    const time = old.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(activityTime(old, false, now)).toBe(time);
    expect(activityTime(old, true, now)).toContain(time);
    expect(activityTime(old, true, now)).not.toBe(time);
  });
});

describe("withOlderPages", () => {
  it("puts the older pages after the first", () => {
    const shown = withOlderPages([item("c"), item("b")], [item("a")]);
    expect(shown.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("leaves out an older item the first page now holds", () => {
    // The first page moved on after the older page was fetched.
    const recent = [item("d", { readAt: stamp(5) }), item("c")];
    const shown = withOlderPages(recent, [item("d"), item("b")]);
    expect(shown.map((x) => x.id)).toEqual(["d", "c", "b"]);
    expect(shown[0].readAt).toEqual(stamp(5));
  });

  it("is the first page alone with nothing older", () => {
    expect(withOlderPages([item("a")], []).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("startsDay", () => {
  const at = (iso: string) => stamp(new Date(iso).getTime() / 1000);

  it("opens a day on the first item", () => {
    expect(
      startsDay(item("a", { createdAt: at("2026-10-30T09:00:00") }), undefined),
    ).toBe(true);
  });

  it("opens one where the item above is from another day", () => {
    const above = item("b", { createdAt: at("2026-10-30T09:00:00") });
    const below = item("a", { createdAt: at("2026-10-29T21:00:00") });
    expect(startsDay(below, above)).toBe(true);
  });

  it("opens none under an item from the same day", () => {
    const above = item("b", { createdAt: at("2026-10-30T18:00:00") });
    const below = item("a", { createdAt: at("2026-10-30T09:00:00") });
    expect(startsDay(below, above)).toBe(false);
  });

  it("opens one when either has no time", () => {
    expect(
      startsDay(item("a"), item("b", { createdAt: at("2026-10-30T09:00:00") })),
    ).toBe(true);
  });
});
