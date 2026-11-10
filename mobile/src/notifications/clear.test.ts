import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { clears, readOfPlace } from "./clear";
import type { NotificationData } from "./content";

const inChannel: NotificationData = {
  serverId: "a",
  itemId: "one",
  kind: ActivityKind.MENTION,
  spaceId: "space",
  channelId: "general",
  threadRootId: "",
  messageId: "m1",
};
const inThread = { ...inChannel, itemId: "two", threadRootId: "root" };

describe("what a read clears", () => {
  it("is the channel's own notifications for a channel, not its threads'", () => {
    const read = { serverId: "a", channelId: "general" };
    expect(clears(read, inChannel)).toBe(true);
    expect(clears(read, inThread)).toBe(false);
    expect(clears(read, { ...inChannel, channelId: "other" })).toBe(false);
  });

  it("is the thread's notifications for a thread", () => {
    const read = { serverId: "a", threadRootId: "root" };
    expect(clears(read, inThread)).toBe(true);
    expect(clears(read, inChannel)).toBe(false);
    expect(clears(read, { ...inThread, threadRootId: "another" })).toBe(false);
  });

  it("is the items marked read", () => {
    expect(clears({ serverId: "a", itemIds: ["two", "three"] }, inThread)).toBe(true);
    expect(clears({ serverId: "a", itemIds: ["two", "three"] }, inChannel)).toBe(false);
    expect(clears({ serverId: "a", itemIds: [] }, inChannel)).toBe(false);
  });

  it("is everything for all", () => {
    expect(clears({ serverId: "a", all: true }, inChannel)).toBe(true);
    expect(clears({ serverId: "a", all: true }, inThread)).toBe(true);
  });

  it("is never another server's", () => {
    expect(clears({ serverId: "b", all: true }, inChannel)).toBe(false);
    expect(clears({ serverId: "b", channelId: "general" }, inChannel)).toBe(false);
    expect(clears({ serverId: "b", threadRootId: "root" }, inThread)).toBe(false);
    expect(clears({ serverId: "b", itemIds: ["one"] }, inChannel)).toBe(false);
  });
});

describe("what a place on screen reads", () => {
  it("is the thread on a thread's screen, the channel on a channel's", () => {
    expect(readOfPlace({ serverId: "a", channelId: "general", threadRootId: "root" })).toEqual({
      serverId: "a",
      threadRootId: "root",
    });
    expect(readOfPlace({ serverId: "a", channelId: "general" })).toEqual({ serverId: "a", channelId: "general" });
    expect(readOfPlace({ serverId: "a", channelId: "general", threadRootId: undefined })).toEqual({
      serverId: "a",
      channelId: "general",
    });
  });
});
