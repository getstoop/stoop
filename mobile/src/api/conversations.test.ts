import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { MessageSchema } from "@stoop/gen/stoop/chat/v1/message_pb";
import { ServerEventSchema } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { describe, expect, it } from "vitest";
import { touchesConversations } from "./conversations";

const event = (payload: MessageInitShape<typeof ServerEventSchema>["payload"]) =>
  create(ServerEventSchema, { payload });

describe("touchesConversations", () => {
  it("reloads on a message edited in a conversation", () => {
    const payload = { case: "messageUpdated", value: create(MessageSchema, { spaceId: "" }) } as const;
    expect(touchesConversations(event(payload))).toBe(true);
  });

  // Every vote is a poll's whole row as an update; it changes no
  // conversation's newest message or unread count.
  it("leaves a poll's update in a conversation: a vote changes nothing listed", () => {
    const payload = {
      case: "messageUpdated",
      value: create(MessageSchema, {
        spaceId: "",
        event: { kind: { case: "poll", value: { question: "Friday?" } } },
      }),
    } as const;
    expect(touchesConversations(event(payload))).toBe(false);
  });

  it("reloads on a poll or its closing row arriving in a conversation", () => {
    const poll = create(MessageSchema, {
      spaceId: "",
      event: { kind: { case: "poll", value: { question: "Friday?" } } },
    });
    const closed = create(MessageSchema, {
      spaceId: "",
      event: { kind: { case: "pollClosed", value: { question: "Friday?" } } },
    });
    expect(touchesConversations(event({ case: "messageCreated", value: poll }))).toBe(true);
    expect(touchesConversations(event({ case: "messageCreated", value: closed }))).toBe(true);
  });
});
