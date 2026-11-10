import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import type { NotificationData } from "./content";
import { notificationData, notificationRoute, placeOf } from "./open";

const mention: NotificationData = {
  serverId: "a",
  itemId: "item",
  kind: ActivityKind.MENTION,
  spaceId: "space",
  channelId: "general",
  threadRootId: "",
  messageId: "m1",
};
const reply = { ...mention, threadRootId: "root" };
const dm = { ...mention, kind: ActivityKind.DM, spaceId: "" };

describe("a notification's data", () => {
  it("comes back as it was sent", () => {
    expect(notificationData({ ...mention })).toEqual(mention);
    expect(notificationData({ ...dm, extra: 1 })).toEqual(dm);
  });

  it("is nothing when it isn't the payload", () => {
    expect(notificationData(undefined)).toBeNull();
    expect(notificationData(null)).toBeNull();
    expect(notificationData("a")).toBeNull();
    expect(notificationData({})).toBeNull();
    expect(notificationData({ ...mention, serverId: "" })).toBeNull();
    expect(notificationData({ ...mention, itemId: "" })).toBeNull();
    expect(notificationData({ ...mention, channelId: 7 })).toBeNull();
    expect(notificationData({ ...mention, messageId: undefined })).toBeNull();
    expect(notificationData({ ...mention, threadRootId: null })).toBeNull();
    expect(notificationData({ ...mention, spaceId: undefined })).toBeNull();
    expect(notificationData({ ...mention, kind: "mention" })).toBeNull();
  });
});

describe("a notification's route", () => {
  it("is its channel at the message", () => {
    expect(notificationRoute(mention)).toEqual({
      pathname: "/s/[id]/space/[spaceId]/channel/[channelId]",
      params: { id: "a", spaceId: "space", channelId: "general", focus: "m1" },
    });
  });

  it("is its thread at the reply when it has one", () => {
    expect(notificationRoute(reply)).toEqual({
      pathname: "/s/[id]/space/[spaceId]/channel/[channelId]/thread/[rootId]",
      params: { id: "a", spaceId: "space", channelId: "general", rootId: "root", focus: "m1" },
    });
  });

  it("is the conversation for a direct message, and its thread", () => {
    expect(notificationRoute(dm)).toEqual({
      pathname: "/s/[id]/dm/[channelId]",
      params: { id: "a", channelId: "general", focus: "m1" },
    });
    expect(notificationRoute({ ...dm, threadRootId: "root" })).toEqual({
      pathname: "/s/[id]/dm/[channelId]/thread/[rootId]",
      params: { id: "a", channelId: "general", rootId: "root", focus: "m1" },
    });
  });
});

describe("where a notification's screen is", () => {
  const channel = ["s", "[id]", "space", "[spaceId]", "channel", "[channelId]"];
  const thread = [...channel, "thread", "[rootId]"];
  const onChannel = { id: "a", spaceId: "space", channelId: "general" };

  it("is here on its own screen, whatever message that was opened at", () => {
    expect(placeOf(notificationRoute(mention), channel, { ...onChannel, focus: "m0" })).toBe("here");
    expect(placeOf(notificationRoute(reply), thread, { ...onChannel, rootId: "root" })).toBe("here");
    expect(placeOf(notificationRoute(dm), ["s", "[id]", "dm", "[channelId]"], { id: "a", channelId: "general" })).toBe(
      "here",
    );
  });

  it("is under one of its channel's threads", () => {
    expect(placeOf(notificationRoute(mention), thread, { ...onChannel, rootId: "root" })).toBe("under");
  });

  it("is elsewhere from anything else", () => {
    expect(placeOf(notificationRoute(mention), channel, { ...onChannel, channelId: "other" })).toBe("elsewhere");
    expect(placeOf(notificationRoute(mention), channel, { ...onChannel, id: "b" })).toBe("elsewhere");
    expect(placeOf(notificationRoute(reply), channel, onChannel)).toBe("elsewhere");
    expect(placeOf(notificationRoute(reply), thread, { ...onChannel, rootId: "another" })).toBe("elsewhere");
    expect(placeOf(notificationRoute(mention), ["s", "[id]", "(tabs)", "activity"], { id: "a" })).toBe("elsewhere");
    expect(placeOf(notificationRoute(mention), ["servers"], {})).toBe("elsewhere");
  });
});
