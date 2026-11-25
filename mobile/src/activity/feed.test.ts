import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { type ActivityItem, ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { MessageAuthorSchema, MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { describe, expect, it } from "vitest";
import { deletionMayClearActivity, olderAfterLoad, olderAfterRead, ownPostRead } from "./feed";

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

// A direct message's entry for one conversation: the server keeps one
// while unread, refreshed under a new id.
const dm = (id: string, read = false): ActivityItem =>
  ({ ...item(id, read), kind: ActivityKind.DM, spaceId: "", channelId: "ada" }) as ActivityItem;

const unread = (items: ActivityItem[]) => items.filter((x) => !x.readAt).map((x) => x.id);
const ids = (items: ActivityItem[]) => items.map((x) => x.id);

describe("olderAfterRead", () => {
  const first = { items: [item("c")], unreadCount: 3 };

  it("stamps the given older items", () => {
    expect(unread(olderAfterRead([item("b"), item("a")], first, ["a"], stamp(9)))).toEqual(["b"]);
  });

  it("stamps all of them for Mark activity read", () => {
    expect(unread(olderAfterRead([item("b"), item("a")], first, "all", stamp(9)))).toEqual([]);
  });

  // The old entry is gone on the server; stamped read it would sit in
  // Read as a second row for the conversation.
  it("drops an older entry the first page refreshed rather than stamping it", () => {
    const refreshed = { items: [dm("dm-2"), item("c")], unreadCount: 3 };
    const after = olderAfterRead([item("b"), dm("dm-1"), dm("dm-0", true)], refreshed, "all", stamp(9));
    expect(ids(after)).toEqual(["b", "dm-0"]);
    expect(unread(after)).toEqual([]);
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

  it("drops an older entry the first page now holds refreshed", () => {
    const first = { items: [dm("dm-2")], unreadCount: 3 };
    const after = olderAfterLoad([item("b"), dm("dm-1"), dm("dm-0", true)], first, stamp(9));
    expect(ids(after)).toEqual(["b", "dm-0"]);
    expect(unread(after)).toEqual(["b"]);
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

describe("ownPostRead", () => {
  const row = (init: MessageInitShape<typeof MessageSchema>) => {
    const made = create(MessageSchema, init);
    made.channelId = "c1";
    made.author ??= create(MessageAuthorSchema, { id: "me" });
    return made;
  };

  it("moves the marker for the reader's own message, and nobody else's", () => {
    expect(ownPostRead(row({}), "me")).toBe("c1");
    expect(ownPostRead(row({ author: { id: "them" } }), "me")).toBeNull();
    expect(ownPostRead(row({}), undefined)).toBeNull();
  });

  it("moves none for a reply only in its thread", () => {
    expect(ownPostRead(row({ threadRootId: "root", inChannel: false }), "me")).toBeNull();
    expect(ownPostRead(row({ threadRootId: "root", inChannel: true }), "me")).toBe("c1");
  });

  it("skips quiet system rows only: the reader's poll and its closing row count", () => {
    const quiet = row({ quiet: true, event: { kind: { case: "channelRenamed", value: {} } } });
    const poll = row({ event: { kind: { case: "poll", value: { question: "Friday?" } } } });
    const closed = row({ event: { kind: { case: "pollClosed", value: { question: "Friday?" } } } });
    expect(ownPostRead(quiet, "me")).toBeNull();
    expect(ownPostRead(poll, "me")).toBe("c1");
    expect(ownPostRead(closed, "me")).toBe("c1");
  });

  it("moves none for the reader's reminder the server delivered", () => {
    const reminder = row({ content: "Order the pizza", event: { kind: { case: "reminder", value: {} } } });
    expect(ownPostRead(reminder, "me")).toBeNull();
  });
});
