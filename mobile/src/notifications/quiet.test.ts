import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { describe, expect, it } from "vitest";
import { staysQuiet } from "./quiet";

const mention = { serverId: "a", channelId: "general", threadRootId: "" };
const reply = { serverId: "a", channelId: "general", threadRootId: "root" };

describe("staysQuiet", () => {
  it("rings with nothing on screen", () => {
    expect(staysQuiet(mention, null)).toBe(false);
    expect(staysQuiet(reply, null)).toBe(false);
  });

  it("is quiet for what is muted or already read, wherever the person is", () => {
    expect(staysQuiet({ ...mention, muted: true }, null)).toBe(true);
    expect(staysQuiet({ ...mention, read: true }, null)).toBe(true);
  });

  it("is quiet while do not disturb holds it, wherever the person is", () => {
    expect(staysQuiet({ ...mention, held: true }, null)).toBe(true);
    expect(staysQuiet({ ...reply, held: true }, { serverId: "a", channelId: "random" })).toBe(true);
    expect(staysQuiet({ ...mention, held: false }, null)).toBe(false);
  });

  it("is quiet for a channel's arrival while that channel is the screen", () => {
    expect(staysQuiet(mention, { serverId: "a", channelId: "general" })).toBe(true);
  });

  it("rings for another channel, and for the same channel ID on another server", () => {
    expect(staysQuiet(mention, { serverId: "a", channelId: "random" })).toBe(false);
    expect(staysQuiet(mention, { serverId: "b", channelId: "general" })).toBe(false);
  });

  it("rings for a channel's arrival while a thread in it is the screen", () => {
    expect(staysQuiet(mention, { serverId: "a", channelId: "general", threadRootId: "root" })).toBe(false);
  });

  it("is quiet for a thread's reply only while that thread is the screen", () => {
    expect(staysQuiet(reply, { serverId: "a", channelId: "general", threadRootId: "root" })).toBe(true);
    expect(staysQuiet(reply, { serverId: "a", channelId: "general", threadRootId: "other" })).toBe(false);
    expect(staysQuiet(reply, { serverId: "b", channelId: "general", threadRootId: "root" })).toBe(false);
  });

  it("rings for a thread's reply while only its channel is the screen", () => {
    expect(staysQuiet(reply, { serverId: "a", channelId: "general" })).toBe(false);
  });
});

describe("staysQuiet by kind", () => {
  const alerts = { mentions: true, directMessages: true, threads: false };

  it("is quiet for a kind whose switch is off, wherever the person is", () => {
    expect(staysQuiet({ ...reply, kind: ActivityKind.THREAD_REPLY, alerts }, null)).toBe(true);
    expect(staysQuiet({ ...mention, kind: ActivityKind.MENTION, alerts: { ...alerts, mentions: false } }, null)).toBe(
      true,
    );
    expect(staysQuiet({ ...mention, kind: ActivityKind.REPLY, alerts: { ...alerts, mentions: false } }, null)).toBe(
      true,
    );
    expect(staysQuiet({ ...mention, kind: ActivityKind.DM, alerts: { ...alerts, directMessages: false } }, null)).toBe(
      true,
    );
  });

  it("rings for a kind whose switch is on, and for one that fits no switch", () => {
    expect(staysQuiet({ ...mention, kind: ActivityKind.MENTION, alerts }, null)).toBe(false);
    expect(staysQuiet({ ...mention, kind: ActivityKind.UNSPECIFIED, alerts }, null)).toBe(false);
  });

  it("holds nothing back without a kind or the switches", () => {
    expect(staysQuiet({ ...reply, alerts }, null)).toBe(false);
    expect(staysQuiet({ ...reply, kind: ActivityKind.THREAD_REPLY }, null)).toBe(false);
  });
});
