import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ActivityData } from "../core/activity";
import {
  type ActivityItem,
  ActivityKind,
} from "../gen/stoop/chat/v1/activity_pb";
import { receiveActivityItem } from "./activity";

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

  const dmItem = (id: string, over: Partial<ActivityItem> = {}) =>
    item(id, {
      kind: ActivityKind.DM,
      spaceId: "",
      channelId: "ada",
      ...over,
    });

  // The server refreshed the conversation's entry under a new id
  // (core withActivityItem has the rule; this is the cache applying it).
  it("replaces an unread direct message entry without double counting", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["activity"],
      data([item("1"), dmItem("dm-1", { preview: "hi" })], 2),
    );
    receiveActivityItem(qc, dmItem("dm-2", { preview: "you there?" }));
    const next = qc.getQueryData<ActivityData>(["activity"]);
    expect(next?.items.map((x) => x.id)).toEqual(["dm-2", "1"]);
    expect(next?.items[0].preview).toBe("you there?");
    expect(next?.unreadCount).toBe(2);
  });

  it("counts a new entry for a conversation whose last one was read", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["activity"],
      data([dmItem("dm-1", { readAt: stamp(10) })], 0),
    );
    receiveActivityItem(qc, dmItem("dm-2", { preview: "back" }));
    const next = qc.getQueryData<ActivityData>(["activity"]);
    expect(next?.items.map((x) => x.id)).toEqual(["dm-2", "dm-1"]);
    expect(next?.items[0].readAt).toBeUndefined();
    expect(next?.unreadCount).toBe(1);
  });
});
