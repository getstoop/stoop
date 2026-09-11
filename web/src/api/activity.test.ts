import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  type ActivityItem,
  ActivityKind,
} from "../gen/stoop/chat/v1/activity_pb";
import {
  type ActivityData,
  activityVerb,
  alertingCount,
  receiveActivityItem,
  unreadCounts,
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
    expect(activityVerb(ActivityKind.DM)).toBe("messaged you");
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

describe("receiveActivityItem", () => {
  it("refetches when the feed has not been loaded", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    receiveActivityItem(qc, item("1"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["activity"] });
    expect(qc.getQueryData(["activity"])).toBeUndefined();
  });

  it("puts a new item on top and counts it", () => {
    const qc = new QueryClient();
    qc.setQueryData(["activity"], data([item("1")], 1));
    receiveActivityItem(qc, item("2"));
    const next = qc.getQueryData<ActivityData>(["activity"]);
    expect(next?.items.map((x) => x.id)).toEqual(["2", "1"]);
    expect(next?.unreadCount).toBe(2);
  });

  it("does not count an item that arrives already read", () => {
    const qc = new QueryClient();
    qc.setQueryData(["activity"], data([item("1")], 1));
    receiveActivityItem(qc, item("2", { readAt: stamp(10) }));
    expect(qc.getQueryData<ActivityData>(["activity"])?.unreadCount).toBe(1);
  });

  it("ignores a replay of a known mention", () => {
    const qc = new QueryClient();
    qc.setQueryData(["activity"], data([item("1"), item("2")], 2));
    receiveActivityItem(qc, item("1", { preview: "edited" }));
    const next = qc.getQueryData<ActivityData>(["activity"]);
    expect(next?.items.map((x) => x.id)).toEqual(["1", "2"]);
    expect(next?.unreadCount).toBe(2);
  });

  const dmItem = (over: Partial<ActivityItem> = {}) =>
    item("dm-ada", {
      kind: ActivityKind.DM,
      spaceId: "",
      channelId: "ada",
      ...over,
    });

  it("refreshes an unread direct message in place without double counting", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["activity"],
      data([item("1"), dmItem({ preview: "hi" })], 2),
    );
    receiveActivityItem(qc, dmItem({ preview: "you there?" }));
    const next = qc.getQueryData<ActivityData>(["activity"]);
    expect(next?.items.map((x) => x.id)).toEqual(["dm-ada", "1"]);
    expect(next?.items[0].preview).toBe("you there?");
    expect(next?.unreadCount).toBe(2);
  });

  it("counts a direct message that goes unread again after being read", () => {
    const qc = new QueryClient();
    qc.setQueryData(["activity"], data([dmItem({ readAt: stamp(10) })], 0));
    receiveActivityItem(qc, dmItem({ preview: "back" }));
    const next = qc.getQueryData<ActivityData>(["activity"]);
    expect(next?.items[0].readAt).toBeUndefined();
    expect(next?.unreadCount).toBe(1);
  });
});
