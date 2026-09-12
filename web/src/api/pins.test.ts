import { create } from "@bufbuild/protobuf";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { type Message, MessageSchema } from "../gen/stoop/chat/v1/message_pb";
import {
  type MessagePinned,
  MessagePinnedSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import { applyPinEvent, markPinned, pinsKey } from "./pins";

// api/clients.ts builds its transport from location.origin as it loads,
// and the unit suite runs in node.
vi.hoisted(() => {
  Object.assign(globalThis, { location: new URL("http://localhost:8091") });
});

const message = (id: string, pinned = false): Message =>
  create(MessageSchema, { id, channelId: "c1", content: id, pinned });

const event = (messageId: string, pinned: boolean): MessagePinned =>
  create(MessagePinnedSchema, {
    spaceId: "s1",
    channelId: "c1",
    messageId,
    pinned,
  });

const window = (qc: QueryClient) =>
  qc.getQueryData<Message[]>(["messages", "c1"]);

describe("markPinned", () => {
  it("flips the flag on the message in the window", () => {
    const qc = new QueryClient();
    qc.setQueryData(["messages", "c1"], [message("m1"), message("m2")]);
    markPinned(qc, "c1", "m2", true);
    expect(window(qc)?.map((m) => [m.id, m.pinned])).toEqual([
      ["m1", false],
      ["m2", true],
    ]);
  });

  it("leaves a window that isn't loaded alone", () => {
    const qc = new QueryClient();
    markPinned(qc, "c1", "m1", true);
    expect(window(qc)).toBeUndefined();
  });
});

describe("applyPinEvent", () => {
  it("marks the message and drops the pin list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["messages", "c1"], [message("m1")]);
    qc.setQueryData(pinsKey("c1"), []);
    applyPinEvent(qc, event("m1", true));
    expect(window(qc)?.[0].pinned).toBe(true);
    expect(qc.getQueryState(pinsKey("c1"))?.isInvalidated).toBe(true);
  });

  it("unmarks on the way back", () => {
    const qc = new QueryClient();
    qc.setQueryData(["messages", "c1"], [message("m1", true)]);
    applyPinEvent(qc, event("m1", false));
    expect(window(qc)?.[0].pinned).toBe(false);
  });

  it("drops another channel's list only when it names that channel", () => {
    const qc = new QueryClient();
    qc.setQueryData(pinsKey("c1"), []);
    qc.setQueryData(pinsKey("c2"), []);
    applyPinEvent(qc, event("m1", true));
    expect(qc.getQueryState(pinsKey("c2"))?.isInvalidated).toBe(false);
  });
});
