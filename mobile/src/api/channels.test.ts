import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { ActivityItemSchema } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import {
  ActivityItemCreatedSchema,
  ChannelMutedSchema,
  ChannelReadSchema,
  MessageDeletedSchema,
  ServerEventSchema,
  SpaceMutedSchema,
  ThreadMutedSchema,
  ThreadReadSchema,
} from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { touchesSpace } from "./channels";

const event = (payload: MessageInitShape<typeof ServerEventSchema>["payload"]) =>
  create(ServerEventSchema, { payload });

// The events that move a channel's alert count: a message addressed to
// the reader arriving, an edit adding or removing a mention, a marker
// passing it, a mute hiding it, a deletion taking it away. Each names its
// space.
describe("touchesSpace", () => {
  it.each([
    ["a message created", { case: "messageCreated", value: create(MessageSchema, { spaceId: "s1" }) }],
    ["a message edited", { case: "messageUpdated", value: create(MessageSchema, { spaceId: "s1" }) }],
    ["a message deleted", { case: "messageDeleted", value: create(MessageDeletedSchema, { spaceId: "s1" }) }],
    ["a channel read", { case: "channelRead", value: create(ChannelReadSchema, { spaceId: "s1" }) }],
    ["a thread read", { case: "threadRead", value: create(ThreadReadSchema, { spaceId: "s1" }) }],
    ["a channel muted", { case: "channelMuted", value: create(ChannelMutedSchema, { spaceId: "s1" }) }],
    ["a thread muted", { case: "threadMuted", value: create(ThreadMutedSchema, { spaceId: "s1" }) }],
    ["a space muted", { case: "spaceMuted", value: create(SpaceMutedSchema, { spaceId: "s1" }) }],
  ] as const)("reloads on %s in the space", (_name, payload) => {
    expect(touchesSpace(event(payload), "s1")).toBe(true);
  });

  it("leaves another space's events", () => {
    const payload = { case: "messageCreated", value: create(MessageSchema, { spaceId: "s2" }) } as const;
    expect(touchesSpace(event(payload), "s1")).toBe(false);
  });

  it("reloads on Ready, whatever was missed", () => {
    expect(touchesSpace(event({ case: "ready", value: {} }), "s1")).toBe(true);
  });

  // The counts come from the server, not the feed: a mention reaches the
  // screen as the message that carries it, which already counts.
  it("leaves an activity item: its message already reloaded the screen", () => {
    const payload = {
      case: "activityItemCreated",
      value: create(ActivityItemCreatedSchema, { item: create(ActivityItemSchema, { spaceId: "s1" }) }),
    } as const;
    expect(touchesSpace(event(payload), "s1")).toBe(false);
  });
});
