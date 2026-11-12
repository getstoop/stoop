import { describe, expect, it } from "vitest";
import { channelMenuItems, channelRowActions } from "./channelMenuRules";

describe("channelMenuItems", () => {
  it("offers Mute and Copy link for a channel that is not muted", () => {
    expect(channelMenuItems({ muted: false }, false)).toEqual([
      { action: "mute", label: "Mute", disabled: false },
      { action: "copyLink", label: "Copy link", disabled: false },
    ]);
  });

  it("offers Unmute once the channel is muted", () => {
    expect(channelMenuItems({ muted: true }, false)[0]).toEqual({ action: "mute", label: "Unmute", disabled: false });
  });

  it("says a muted space mutes the channel, and takes no press", () => {
    const inert = { action: "mute", label: "Muted by space", disabled: true };
    expect(channelMenuItems({ muted: false }, true)[0]).toEqual(inert);
    expect(channelMenuItems({ muted: true }, true)[0]).toEqual(inert);
  });

  it("keeps Copy link in a muted space", () => {
    expect(channelMenuItems({ muted: false }, true)[1]).toEqual({
      action: "copyLink",
      label: "Copy link",
      disabled: false,
    });
  });
});

describe("channelRowActions", () => {
  it("names the same items for a screen reader", () => {
    expect(channelRowActions({ muted: false }, false)).toEqual([
      { name: "mute", label: "Mute" },
      { name: "copyLink", label: "Copy link" },
    ]);
    expect(channelRowActions({ muted: true }, false)[0]).toEqual({ name: "mute", label: "Unmute" });
  });

  it("leaves out the mute a muted space makes inert", () => {
    expect(channelRowActions({ muted: false }, true)).toEqual([{ name: "copyLink", label: "Copy link" }]);
  });
});
