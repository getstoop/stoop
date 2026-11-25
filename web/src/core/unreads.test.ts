import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import {
  MessageAuthorSchema,
  MessageSchema,
} from "../gen/stoop/chat/v1/message_pb";
import { badgeCount, isOwnSend, isUnread, withArrival } from "./unreads";

const row = (init: MessageInitShape<typeof MessageSchema> = {}) => {
  const made = create(MessageSchema, init);
  made.id = "m9";
  made.author ??= create(MessageAuthorSchema, { id: "me" });
  return made;
};
const reminder = (author = "me") =>
  row({
    author: { id: author },
    content: "Order the pizza",
    event: { kind: { case: "reminder", value: {} } },
  });

describe("isOwnSend", () => {
  it("is a row the reader authored: a message, a poll, its closing row", () => {
    expect(isOwnSend(row(), "me")).toBe(true);
    expect(
      isOwnSend(
        row({ event: { kind: { case: "poll", value: { question: "?" } } } }),
        "me",
      ),
    ).toBe(true);
    expect(
      isOwnSend(
        row({
          event: { kind: { case: "pollClosed", value: { question: "?" } } },
        }),
        "me",
      ),
    ).toBe(true);
  });

  it("is nobody else's row, and nothing with no reader", () => {
    expect(isOwnSend(row({ author: { id: "ada" } }), "me")).toBe(false);
    expect(isOwnSend(row(), undefined)).toBe(false);
    expect(isOwnSend(row(), null)).toBe(false);
    expect(isOwnSend(row(), "")).toBe(false);
  });

  it("is not a reminder the server delivered, the reader's own included", () => {
    expect(isOwnSend(reminder(), "me")).toBe(false);
    expect(isOwnSend(reminder("ada"), "me")).toBe(false);
  });
});

describe("withArrival", () => {
  const held = { unreadCount: 2 };

  it("reads up to the reader's own send, wherever they are looking", () => {
    expect(withArrival(held, row(), "me", false)).toEqual({
      lastMessageId: "m9",
      lastReadMessageId: "m9",
      unreadCount: 0,
    });
  });

  it("counts someone else's row unread, unless the channel is being read", () => {
    const theirs = row({ author: { id: "ada" } });
    expect(withArrival(held, theirs, "me", false)).toEqual({
      lastMessageId: "m9",
      unreadCount: 3,
    });
    expect(withArrival(held, theirs, "me", true)).toEqual({
      lastMessageId: "m9",
      lastReadMessageId: "m9",
      unreadCount: 0,
    });
  });

  it("treats the reader's delivered reminder as someone else's row", () => {
    // Not looking: one more unread, and the marker stays where it was,
    // so what was unread before it still is.
    expect(withArrival(held, reminder(), "me", false)).toEqual({
      lastMessageId: "m9",
      unreadCount: 3,
    });
    // Looking: read as it lands, which the channel's hook tells the server.
    expect(withArrival(held, reminder(), "me", true)).toEqual({
      lastMessageId: "m9",
      lastReadMessageId: "m9",
      unreadCount: 0,
    });
  });
});

const channel = (
  id: string,
  lastMessageId = "",
  lastReadMessageId = "",
): Channel => ({ id, lastMessageId, lastReadMessageId }) as Channel;

describe("badgeCount", () => {
  it("shows the number as-is up to the cap", () => {
    expect(badgeCount(0)).toBe("0");
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(99)).toBe("99");
  });

  it("caps past 99", () => {
    expect(badgeCount(100)).toBe("99+");
    expect(badgeCount(4321)).toBe("99+");
  });
});

describe("isUnread", () => {
  it("is unread when the last message is newer than the last read", () => {
    expect(isUnread(channel("general", "02", "01"))).toBe(true);
  });

  it("is read once the marks match", () => {
    expect(isUnread(channel("general", "02", "02"))).toBe(false);
  });

  it("is unread when the channel was never read", () => {
    expect(isUnread(channel("general", "01"))).toBe(true);
  });

  it("is read when the channel has no messages at all", () => {
    expect(isUnread(channel("general"))).toBe(false);
  });

  // A stale read mark ahead of the last message (a deletion, say) must not
  // bold the row.
  it("is read when the read mark is ahead", () => {
    expect(isUnread(channel("general", "01", "02"))).toBe(false);
  });
});
