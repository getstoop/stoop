import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { ActivityItemSchema } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { ChannelSchema } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import {
  ActivityItemCreatedSchema,
  ChannelDeletedSchema,
  ChannelMemberChangedSchema,
  ChannelMutedSchema,
  ChannelReadSchema,
  MemberRemovedSchema,
  MemberUpdatedSchema,
  MessageDeletedSchema,
  PresenceChangedSchema,
  ServerEventSchema,
  SpaceDeletedSchema,
  SpaceJoinedSchema,
  SpaceMutedSchema,
  ThreadMutedSchema,
  ThreadReadSchema,
} from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { touchesAlerts } from "./alerts";

const event = (payload: MessageInitShape<typeof ServerEventSchema>["payload"]) =>
  create(ServerEventSchema, { payload });

// The events that can move a server's total: a message anywhere, a
// marker passing one, a mute, a deletion, a space or a conversation
// coming or going.
describe("touchesAlerts", () => {
  it.each([
    ["a message created", { case: "messageCreated", value: create(MessageSchema, { spaceId: "s1" }) }],
    ["a message in a conversation", { case: "messageCreated", value: create(MessageSchema, { spaceId: "" }) }],
    ["a message edited", { case: "messageUpdated", value: create(MessageSchema, { spaceId: "s1" }) }],
    ["a message deleted", { case: "messageDeleted", value: create(MessageDeletedSchema, { spaceId: "s1" }) }],
    ["a channel read", { case: "channelRead", value: create(ChannelReadSchema, { spaceId: "s1" }) }],
    ["a thread read", { case: "threadRead", value: create(ThreadReadSchema, { spaceId: "s1" }) }],
    ["a channel muted", { case: "channelMuted", value: create(ChannelMutedSchema, { spaceId: "s1" }) }],
    ["a thread muted", { case: "threadMuted", value: create(ThreadMutedSchema, { spaceId: "s1" }) }],
    ["a space muted", { case: "spaceMuted", value: create(SpaceMutedSchema, { spaceId: "s1" }) }],
    ["a channel deleted", { case: "channelDeleted", value: create(ChannelDeletedSchema, { spaceId: "s1" }) }],
    ["a space deleted", { case: "spaceDeleted", value: create(SpaceDeletedSchema, { spaceId: "s1" }) }],
    ["a space joined", { case: "spaceJoined", value: create(SpaceJoinedSchema, {}) }],
    ["someone leaving a space", { case: "memberRemoved", value: create(MemberRemovedSchema, { spaceId: "s1" }) }],
    ["a conversation opened", { case: "channelCreated", value: create(ChannelSchema, { spaceId: "" }) }],
    [
      "someone joining a private channel",
      { case: "channelMemberJoined", value: create(ChannelMemberChangedSchema, { spaceId: "s1" }) },
    ],
    [
      "someone leaving a private channel",
      { case: "channelMemberLeft", value: create(ChannelMemberChangedSchema, { spaceId: "s1" }) },
    ],
  ] as const)("asks again on %s", (_name, payload) => {
    expect(touchesAlerts(event(payload))).toBe(true);
  });

  it("asks again on Ready, whatever was missed", () => {
    expect(touchesAlerts(event({ case: "ready", value: {} }))).toBe(true);
  });

  it("leaves a channel made in a space: nothing is addressed to anyone there yet", () => {
    expect(touchesAlerts(event({ case: "channelCreated", value: create(ChannelSchema, { spaceId: "s1" }) }))).toBe(
      false,
    );
  });

  // The counts come from the server, not the feed: a mention reaches
  // the store as the message that carries it, which already asks.
  it("leaves an activity item: its message already asked", () => {
    const payload = {
      case: "activityItemCreated",
      value: create(ActivityItemCreatedSchema, { item: create(ActivityItemSchema, { spaceId: "s1" }) }),
    } as const;
    expect(touchesAlerts(event(payload))).toBe(false);
  });

  it("leaves what changes no count", () => {
    expect(touchesAlerts(event({ case: "presenceChanged", value: create(PresenceChangedSchema, {}) }))).toBe(false);
    expect(touchesAlerts(event({ case: "memberUpdated", value: create(MemberUpdatedSchema, {}) }))).toBe(false);
  });
});
