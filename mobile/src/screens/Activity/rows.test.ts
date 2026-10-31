import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { type ActivityItem, ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { feedRows } from "./rows";

const at = (iso: string): Timestamp =>
  ({
    $typeName: "google.protobuf.Timestamp",
    seconds: BigInt(new Date(iso).getTime() / 1000),
    nanos: 0,
  }) as Timestamp;

const item = (id: string, createdAt: string, read = false): ActivityItem =>
  ({
    id,
    kind: ActivityKind.MENTION,
    spaceId: "s1",
    channelId: "general",
    messageId: `m-${id}`,
    preview: "",
    muted: false,
    createdAt: at(createdAt),
    readAt: read ? at(createdAt) : undefined,
  }) as ActivityItem;

const now = new Date("2026-10-30T12:00:00");

describe("feedRows", () => {
  it("is nothing for an empty feed", () => {
    expect(feedRows([], now)).toEqual([]);
  });

  it("puts what is unread under New, with its count, before Read", () => {
    const rows = feedRows(
      [item("d", "2026-10-30T11:00:00"), item("c", "2026-10-30T10:00:00", true), item("b", "2026-10-30T09:00:00")],
      now,
    );
    expect(rows.map((row) => row.key)).toEqual(["head:new", "d", "b", "head:read", "c"]);
    expect(rows[0]).toMatchObject({ kind: "newHead", count: 2 });
  });

  it("has no New heading when everything is read", () => {
    const rows = feedRows([item("a", "2026-10-30T09:00:00", true)], now);
    expect(rows.map((row) => row.kind)).toEqual(["readHead", "read"]);
  });

  it("labels the first read row of each day, and marks the last row", () => {
    const rows = feedRows(
      [
        item("e", "2026-10-30T11:00:00", true),
        item("d", "2026-10-30T08:00:00", true),
        item("c", "2026-10-29T20:00:00", true),
        item("b", "2026-10-29T09:00:00", true),
        item("a", "2026-10-26T09:00:00", true),
      ],
      now,
    ).filter((row) => row.kind === "read");
    expect(rows.map((row) => row.day)).toEqual(["Today", undefined, "Yesterday", undefined, "Monday"]);
    expect(rows.map((row) => row.last)).toEqual([false, false, false, false, true]);
  });

  it("counts days among read rows only, past the unread between them", () => {
    const rows = feedRows(
      [item("c", "2026-10-30T11:00:00", true), item("b", "2026-10-30T10:00:00"), item("a", "2026-10-30T09:00:00", true)],
      now,
    ).filter((row) => row.kind === "read");
    expect(rows.map((row) => row.day)).toEqual(["Today", undefined]);
  });
});
