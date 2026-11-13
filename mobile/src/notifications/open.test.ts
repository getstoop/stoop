import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import type { NotificationData } from "./content";
import { notificationRoute, placeOf, type TapScene, tapAction } from "./open";

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

const channel = ["s", "[id]", "space", "[spaceId]", "channel", "[channelId]"];
const thread = [...channel, "thread", "[rootId]"];
const onChannel = { id: "a", spaceId: "space", channelId: "general" };

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
  it("is here on its own screen, whatever message that was opened at", () => {
    expect(placeOf(notificationRoute(mention), channel, { ...onChannel, focus: "m0" })).toBe("here");
    expect(placeOf(notificationRoute(reply), thread, { ...onChannel, rootId: "root" })).toBe("here");
    expect(placeOf(notificationRoute(dm), ["s", "[id]", "dm", "[channelId]"], { id: "a", channelId: "general" })).toBe(
      "here",
    );
  });

  it("is under one of its channel's threads, and a conversation under one of its own", () => {
    expect(placeOf(notificationRoute(mention), thread, { ...onChannel, rootId: "root" })).toBe("under");
    expect(
      placeOf(notificationRoute(dm), ["s", "[id]", "dm", "[channelId]", "thread", "[rootId]"], {
        id: "a",
        channelId: "general",
        rootId: "root",
      }),
    ).toBe("under");
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

describe("what a tap does", () => {
  const scene = (over: Partial<TapScene> = {}): TapScene => ({
    serverId: "a",
    saved: ["a", "b"],
    mounting: false,
    segments: ["s", "[id]", "(tabs)", "activity"],
    params: { id: "a" },
    ...over,
  });
  const route = notificationRoute(mention);

  it("pushes from anywhere else on its server", () => {
    expect(tapAction(mention, scene())).toEqual({ do: "open", route, how: "push" });
    expect(tapAction(mention, scene({ segments: channel, params: { ...onChannel, channelId: "other" } }))).toEqual({
      do: "open",
      route,
      how: "push",
    });
  });

  it("sends the screen it points at to the message", () => {
    expect(tapAction(mention, scene({ segments: channel, params: onChannel }))).toEqual({
      do: "open",
      route,
      how: "focus",
    });
  });

  it("goes back to the channel from one of its threads", () => {
    expect(tapAction(mention, scene({ segments: thread, params: { ...onChannel, rootId: "root" } }))).toEqual({
      do: "open",
      route,
      how: "back",
    });
  });

  it("closes what is over the server and pushes, without a look at what is beneath", () => {
    expect(tapAction(mention, scene({ segments: ["servers"], params: {} }))).toEqual({
      do: "open",
      route,
      close: "over",
      how: "push",
    });
    expect(tapAction(mention, scene({ segments: ["sign-in"], params: onChannel }))).toEqual({
      do: "open",
      route,
      close: "over",
      how: "push",
    });
  });

  it("closes New message or Add a space and pushes", () => {
    for (const sheet of ["new-message", "add-space"]) {
      expect(tapAction(mention, scene({ segments: ["s", "[id]", sheet] }))).toEqual({
        do: "open",
        route,
        close: "sheet",
        how: "push",
      });
    }
  });

  it("pushes as the layout mounts, whatever the screen in front is said to be", () => {
    const mounting = { do: "open", route, close: "over", how: "push" };
    expect(tapAction(mention, scene({ mounting: true }))).toEqual(mounting);
    expect(tapAction(mention, scene({ mounting: true, segments: channel, params: onChannel }))).toEqual(mounting);
    expect(tapAction(mention, scene({ mounting: true, segments: ["s", "[id]", "new-message"] }))).toEqual(mounting);
  });

  it("swaps to another saved server, mounting or not", () => {
    const other = { ...mention, serverId: "b" };
    expect(tapAction(other, scene())).toEqual({ do: "swap", serverId: "b" });
    expect(tapAction(other, scene({ mounting: true }))).toEqual({ do: "swap", serverId: "b" });
  });

  it("opens a channel with no message named where it stands, and has no item", () => {
    const link = { serverId: "a", spaceId: "space", channelId: "general", threadRootId: "", messageId: "" };
    expect(tapAction(link, scene())).toEqual({
      do: "open",
      route: {
        pathname: "/s/[id]/space/[spaceId]/channel/[channelId]",
        params: { id: "a", spaceId: "space", channelId: "general" },
      },
      how: "push",
    });
  });

  it("shows a space with no channel named on the Spaces tab, there already as the layout mounts", () => {
    const space = { serverId: "a", spaceId: "space", channelId: "", threadRootId: "", messageId: "" };
    expect(tapAction(space, scene())).toEqual({ do: "space", spaceId: "space", shown: false });
    expect(tapAction(space, scene({ segments: channel, params: onChannel }))).toEqual({
      do: "space",
      spaceId: "space",
      shown: false,
    });
    expect(tapAction(space, scene({ mounting: true }))).toEqual({ do: "space", spaceId: "space", shown: true });
    expect(tapAction({ ...space, serverId: "b" }, scene())).toEqual({ do: "swap", serverId: "b" });
  });

  it("drops a tap for a server forgotten since", () => {
    expect(tapAction({ ...mention, serverId: "gone" }, scene())).toEqual({ do: "drop" });
  });
});
