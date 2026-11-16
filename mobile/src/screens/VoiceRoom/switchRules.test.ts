import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import {
  ChannelMutedSchema,
  ChannelReadSchema,
  MessageDeletedSchema,
  ServerEventSchema,
} from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { chatWaiting, opensOn, sideLabel, touchesChat } from "./switchRules";

describe("opensOn", () => {
  it("opens the room on Call", () => {
    expect(opensOn(undefined)).toBe("call");
    expect(opensOn("")).toBe("call");
  });

  it("opens it on Chat at a message", () => {
    expect(opensOn("m1")).toBe("chat");
  });
});

describe("chatWaiting", () => {
  const room = { unreadCount: 2, muted: false };

  it("dots Chat for messages past the marker, seen from Call", () => {
    expect(chatWaiting(room, false, "call")).toBe(true);
  });

  it("has no dot with nothing unread", () => {
    expect(chatWaiting({ ...room, unreadCount: 0 }, false, "call")).toBe(false);
  });

  it("has none while Chat is the side shown", () => {
    expect(chatWaiting(room, false, "chat")).toBe(false);
  });

  it("has none for a muted room, or in a muted space", () => {
    expect(chatWaiting({ ...room, muted: true }, false, "call")).toBe(false);
    expect(chatWaiting(room, true, "call")).toBe(false);
  });
});

describe("sideLabel", () => {
  it("names each side", () => {
    expect(sideLabel("call", { inCall: false, waiting: false })).toBe("Call");
    expect(sideLabel("chat", { inCall: false, waiting: false })).toBe("Chat");
  });

  it("says the reader is in the call, on Call alone", () => {
    expect(sideLabel("call", { inCall: true, waiting: false })).toBe("Call, you're in it");
    expect(sideLabel("chat", { inCall: true, waiting: false })).toBe("Chat");
  });

  it("says Chat has new messages, on Chat alone", () => {
    expect(sideLabel("chat", { inCall: false, waiting: true })).toBe("Chat, new messages");
    expect(sideLabel("call", { inCall: false, waiting: true })).toBe("Call");
  });
});

describe("touchesChat", () => {
  const event = (payload: MessageInitShape<typeof ServerEventSchema>["payload"]) =>
    create(ServerEventSchema, { payload });

  it.each([
    ["a message there", { case: "messageCreated", value: create(MessageSchema, { channelId: "v1" }) }],
    ["one deleted there", { case: "messageDeleted", value: create(MessageDeletedSchema, { channelId: "v1" }) }],
    ["its marker moving", { case: "channelRead", value: create(ChannelReadSchema, { channelId: "v1" }) }],
  ] as const)("reloads on %s", (_name, payload) => {
    expect(touchesChat(event(payload), "v1")).toBe(true);
  });

  it.each([
    ["a message elsewhere", { case: "messageCreated", value: create(MessageSchema, { channelId: "c2" }) }],
    ["another channel read", { case: "channelRead", value: create(ChannelReadSchema, { channelId: "c2" }) }],
    ["the room muted", { case: "channelMuted", value: create(ChannelMutedSchema, { channelId: "v1" }) }],
  ] as const)("leaves %s", (_name, payload) => {
    expect(touchesChat(event(payload), "v1")).toBe(false);
  });
});
