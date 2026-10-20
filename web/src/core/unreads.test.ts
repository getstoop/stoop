import { describe, expect, it } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import { badgeCount, isUnread } from "./unreads";

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
