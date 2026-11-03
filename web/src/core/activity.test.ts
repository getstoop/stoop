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
  NEW_AUTO_PAGES,
  needsOlderPageForNew,
  readMayClearActivity,
  startsDay,
  withActivityItem,
  withActivityRead,
  withOlderPages,
  withoutRefreshed,
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

  const dm = (id: string, over: Partial<ActivityItem> = {}) =>
    item(id, {
      kind: ActivityKind.DM,
      spaceId: "",
      channelId: "ada",
      ...over,
    });
  const inThread = (id: string, over: Partial<ActivityItem> = {}) =>
    item(id, {
      kind: ActivityKind.THREAD_REPLY,
      threadRootId: "root1",
      ...over,
    });

  // The server refreshed the conversation's entry under a new id: the
  // held one is gone there, and the count has not moved.
  it("replaces the unread entry for a conversation without double counting", () => {
    const next = withActivityItem(
      data([item("1"), dm("dm-1", { preview: "hi" })], 2),
      dm("dm-2", { preview: "you there?" }),
    );
    expect(next.items.map((x) => x.id)).toEqual(["dm-2", "1"]);
    expect(next.items[0].preview).toBe("you there?");
    expect(next.unreadCount).toBe(2);
  });

  it("keeps a read entry for the conversation beside the new one", () => {
    const next = withActivityItem(
      data([dm("dm-1", { readAt: stamp(10) })], 0),
      dm("dm-2", { preview: "back" }),
    );
    expect(next.items.map((x) => x.id)).toEqual(["dm-2", "dm-1"]);
    expect(next.unreadCount).toBe(1);
  });

  it("leaves an entry for another conversation alone", () => {
    const next = withActivityItem(
      data([dm("dm-1")], 1),
      dm("dm-bea", { channelId: "bea" }),
    );
    expect(next.items.map((x) => x.id)).toEqual(["dm-bea", "dm-1"]);
    expect(next.unreadCount).toBe(2);
  });

  it("replaces the unread entry for a thread, and only that", () => {
    const held = data(
      [
        item("m", { threadRootId: "root1" }),
        inThread("t-1"),
        inThread("other", { threadRootId: "root2" }),
      ],
      3,
    );
    const next = withActivityItem(held, inThread("t-2"));
    expect(next.items.map((x) => x.id)).toEqual(["t-2", "m", "other"]);
    expect(next.unreadCount).toBe(3);
  });

  // Refreshed behind the reader's marker, the entry comes back read; the
  // unread one it replaced leaves the count.
  it("takes a replaced entry off the count when the new one arrives read", () => {
    const next = withActivityItem(
      data([dm("dm-1")], 1),
      dm("dm-2", { readAt: stamp(10) }),
    );
    expect(next.items.map((x) => x.id)).toEqual(["dm-2"]);
    expect(next.unreadCount).toBe(0);
  });

  it("hands back the same feed for a replay of a known direct message", () => {
    const feed = data([dm("dm-1")], 1);
    expect(withActivityItem(feed, dm("dm-1", { preview: "again" }))).toBe(feed);
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

  // The conversation's entry was refreshed under a new id after the
  // older page was fetched: the old row is gone on the server.
  it("leaves out an unread older entry the first page refreshed", () => {
    const dm = (id: string, over: Partial<ActivityItem> = {}) =>
      item(id, {
        kind: ActivityKind.DM,
        spaceId: "",
        channelId: "ada",
        ...over,
      });
    const recent = [dm("dm-2"), item("c")];
    const older = [item("b"), dm("dm-1"), dm("dm-0", { readAt: stamp(5) })];
    expect(withOlderPages(recent, older).map((x) => x.id)).toEqual([
      "dm-2",
      "c",
      "b",
      "dm-0",
    ]);
  });

  it("leaves out an unread older entry for a thread the first page holds", () => {
    const inThread = (id: string, root: string) =>
      item(id, { kind: ActivityKind.THREAD_REPLY, threadRootId: root });
    const recent = [inThread("t-2", "root1")];
    const older = [inThread("t-1", "root1"), inThread("s-1", "root2")];
    expect(withOlderPages(recent, older).map((x) => x.id)).toEqual([
      "t-2",
      "s-1",
    ]);
  });
});

describe("withoutRefreshed", () => {
  it("hands back the same pages when nothing was refreshed", () => {
    const older = [
      item("dm-1", { kind: ActivityKind.DM, spaceId: "", channelId: "ada" }),
    ];
    expect(withoutRefreshed([item("b")], older)).toBe(older);
  });

  // A mention is never coalesced, whatever it shares with a held item.
  it("drops nothing for a mention in the same channel", () => {
    const older = [item("a")];
    expect(withoutRefreshed([item("b")], older)).toBe(older);
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

describe("needsOlderPageForNew", () => {
  const read = { readAt: stamp(1) };

  it("asks for a page while the server counts more unread than is held", () => {
    const held = [item("c"), item("b", read)];
    expect(needsOlderPageForNew(2, held, false, 0)).toBe(true);
  });

  it("stops once New holds everything counted", () => {
    const held = [item("c"), item("b", read), item("a")];
    expect(needsOlderPageForNew(2, held, false, 3)).toBe(false);
  });

  it("stops when the count is short of what is held", () => {
    // An item read elsewhere, counted out by the server but still
    // drawn unread here.
    expect(needsOlderPageForNew(0, [item("a")], false, 0)).toBe(false);
  });

  it("stops when the oldest page came back empty", () => {
    expect(needsOlderPageForNew(2, [item("a")], true, 0)).toBe(false);
  });

  it("stops at the bound", () => {
    const held = [item("a", read)];
    expect(needsOlderPageForNew(1, held, false, NEW_AUTO_PAGES - 1)).toBe(true);
    expect(needsOlderPageForNew(1, held, false, NEW_AUTO_PAGES)).toBe(false);
  });

  it("asks for nothing with nothing held to ask before", () => {
    expect(needsOlderPageForNew(1, [], false, 0)).toBe(false);
  });
});
