import { type ActivityItem, ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { notificationContent } from "./content";

const server = { id: "abc123", name: "Elm Street" };

const item = (over: Partial<ActivityItem> = {}): ActivityItem =>
  ({
    id: "i1",
    kind: ActivityKind.MENTION,
    spaceId: "s1",
    channelId: "c1",
    messageId: "m1",
    actor: { id: "u1", username: "priya", displayName: "Priya Shah" },
    preview: "@ada are you coming?",
    muted: false,
    threadRootId: "",
    ...over,
  }) as ActivityItem;

const dm = (over: Partial<ActivityItem> = {}) => item({ kind: ActivityKind.DM, spaceId: "", channelId: "d1", ...over });

describe("notificationContent", () => {
  it("titles a mention with who did what, and says the preview", () => {
    const content = notificationContent(item(), server, {}, false);
    expect(content.title).toBe("Priya Shah mentioned you");
    expect(content.body).toBe("@ada are you coming?");
  });

  it("titles a reply and a thread's reply by their verbs", () => {
    expect(notificationContent(item({ kind: ActivityKind.REPLY }), server, {}, false).title).toBe(
      "Priya Shah replied to you",
    );
    expect(notificationContent(item({ kind: ActivityKind.THREAD_REPLY }), server, {}, false).title).toBe(
      "Priya Shah replied in a thread",
    );
  });

  it("titles a direct message with the sender alone", () => {
    expect(notificationContent(dm(), server, {}, false).title).toBe("Priya Shah");
  });

  it("names the actor by username, then as Someone", () => {
    const unnamed = { id: "u1", username: "priya", displayName: "" } as ActivityItem["actor"];
    expect(notificationContent(dm({ actor: unnamed }), server, {}, false).title).toBe("priya");
    expect(notificationContent(item({ actor: undefined }), server, {}, false).title).toBe("Someone mentioned you");
  });

  it("has no subtitle for a direct message with one server saved", () => {
    expect(notificationContent(dm(), server, {}, false).subtitle).toBeUndefined();
  });

  it("says where, nearest first: the channel, the space, the server", () => {
    expect(notificationContent(item(), server, { channel: "general" }, false).subtitle).toBe("#general");
    expect(notificationContent(item(), server, { channel: "general", space: "Neighbours" }, false).subtitle).toBe(
      "#general · Neighbours",
    );
    expect(notificationContent(item(), server, { channel: "general", space: "Neighbours" }, true).subtitle).toBe(
      "#general · Neighbours · Elm Street",
    );
  });

  it("says only the server for a direct message, and for a channel not known yet", () => {
    expect(notificationContent(dm(), server, {}, true).subtitle).toBe("Elm Street");
    expect(notificationContent(item(), server, {}, true).subtitle).toBe("Elm Street");
    expect(notificationContent(item(), server, {}, false).subtitle).toBeUndefined();
  });

  it("is identified by its entry under its server", () => {
    expect(notificationContent(item(), server, {}, false).identifier).toBe("abc123:i1");
    expect(notificationContent(dm(), server, {}, false).identifier).toBe("abc123:d1");
    const reply = item({ kind: ActivityKind.THREAD_REPLY, threadRootId: "root" });
    expect(notificationContent(reply, server, {}, false).identifier).toBe("abc123:root");
  });

  it("carries where to go as plain values", () => {
    const reply = item({ kind: ActivityKind.THREAD_REPLY, threadRootId: "root" });
    expect(notificationContent(reply, server, {}, false).data).toEqual({
      serverId: "abc123",
      itemId: "i1",
      kind: ActivityKind.THREAD_REPLY,
      spaceId: "s1",
      channelId: "c1",
      threadRootId: "root",
      messageId: "m1",
    });
  });
});
