import { describe, expect, it } from "vitest";
import { channelMenuItems, channelRowActions, channelTopic } from "./channelMenuRules";

const about = { action: "about", label: "About this channel", disabled: false };

describe("channelMenuItems", () => {
  it("offers Mute and Copy link for a channel that is not muted", () => {
    expect(channelMenuItems({ muted: false, topic: "" }, false)).toEqual([
      { action: "mute", label: "Mute", disabled: false },
      { action: "copyLink", label: "Copy link", disabled: false },
    ]);
  });

  it("offers Unmute once the channel is muted", () => {
    expect(channelMenuItems({ muted: true, topic: "" }, false)[0]).toEqual({
      action: "mute",
      label: "Unmute",
      disabled: false,
    });
  });

  it("says a muted space mutes the channel, and takes no press", () => {
    const inert = { action: "mute", label: "Muted by space", disabled: true };
    expect(channelMenuItems({ muted: false, topic: "" }, true)[0]).toEqual(inert);
    expect(channelMenuItems({ muted: true, topic: "" }, true)[0]).toEqual(inert);
  });

  it("keeps Copy link in a muted space", () => {
    expect(channelMenuItems({ muted: false, topic: "" }, true)[1]).toEqual({
      action: "copyLink",
      label: "Copy link",
      disabled: false,
    });
  });

  it("offers About this channel last, for a channel with a topic", () => {
    expect(channelMenuItems({ muted: false, topic: "What we are reading" }, false)).toEqual([
      { action: "mute", label: "Mute", disabled: false },
      { action: "copyLink", label: "Copy link", disabled: false },
      about,
    ]);
    expect(channelMenuItems({ muted: true, topic: "What we are reading" }, true)[2]).toEqual(about);
  });

  it("leaves About this channel out when the topic is only spaces", () => {
    expect(channelMenuItems({ muted: false, topic: "  " }, false)).toHaveLength(2);
  });
});

describe("channelRowActions", () => {
  it("names the same items for a screen reader", () => {
    expect(channelRowActions({ muted: false, topic: "" }, false)).toEqual([
      { name: "mute", label: "Mute" },
      { name: "copyLink", label: "Copy link" },
    ]);
    expect(channelRowActions({ muted: true, topic: "" }, false)[0]).toEqual({ name: "mute", label: "Unmute" });
  });

  it("leaves out the mute a muted space makes inert", () => {
    expect(channelRowActions({ muted: false, topic: "" }, true)).toEqual([{ name: "copyLink", label: "Copy link" }]);
  });

  it("names About this channel for a channel with a topic", () => {
    expect(channelRowActions({ muted: false, topic: "What we are reading" }, true)).toEqual([
      { name: "copyLink", label: "Copy link" },
      { name: "about", label: "About this channel" },
    ]);
  });
});

describe("channelTopic", () => {
  it("is the topic without the spaces around it", () => {
    expect(channelTopic({ topic: " What we are reading " })).toBe("What we are reading");
    expect(channelTopic({ topic: "  " })).toBe("");
  });
});
