import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import type { NotificationData } from "./content";
import { type TapResponse, tappedNotification } from "./tapped";

const TAP = "default";

const data: NotificationData = {
  serverId: "a",
  itemId: "item",
  kind: ActivityKind.DM,
  spaceId: "",
  channelId: "d1",
  threadRootId: "",
  messageId: "m1",
};

const response = (over: { action?: string; date?: number; data?: unknown } = {}): TapResponse => ({
  actionIdentifier: over.action ?? TAP,
  notification: {
    date: over.date ?? 1000,
    request: { identifier: "a:d1", content: { data: "data" in over ? over.data : data } },
  },
});

describe("a tapped notification", () => {
  it("is its data, under a key of its identifier and when it was shown", () => {
    expect(tappedNotification(response(), ["a", "b"], TAP)).toEqual({ key: "a:d1@1000", data });
  });

  it("has a new key when the conversation's next notification is tapped", () => {
    const first = tappedNotification(response(), ["a"], TAP);
    const again = tappedNotification(response(), ["a"], TAP);
    const next = tappedNotification(response({ date: 2000 }), ["a"], TAP);
    expect(again?.key).toBe(first?.key);
    expect(next?.key).not.toBe(first?.key);
  });

  it("is nothing for an action that isn't the tap", () => {
    expect(tappedNotification(response({ action: "reply" }), ["a"], TAP)).toBeNull();
  });

  it("is nothing for data that isn't ours", () => {
    expect(tappedNotification(response({ data: undefined }), ["a"], TAP)).toBeNull();
    expect(tappedNotification(response({ data: { url: "https://example.com" } }), ["a"], TAP)).toBeNull();
  });

  it("is nothing for a server no longer saved", () => {
    expect(tappedNotification(response(), ["b"], TAP)).toBeNull();
    expect(tappedNotification(response(), [], TAP)).toBeNull();
  });
});
