import { describe, expect, it, vi } from "vitest";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { defaultChannelChoices, landingChannel } from "./channels";

// This module reaches ./clients, which builds its transport from
// location.origin at import time; the node environment has no location.
vi.hoisted(() => {
  (globalThis as { location?: unknown }).location = new URL(
    "http://localhost/",
  );
});

const channel = (id: string, kind = ChannelKind.TEXT): Channel =>
  ({ id, name: id, kind }) as Channel;

const space = (defaultChannelId = ""): Space =>
  ({ id: "hq", defaultChannelId }) as Space;

describe("defaultChannelChoices", () => {
  it("offers the text channels in the order they came", () => {
    const channels = [
      channel("general"),
      channel("lounge", ChannelKind.VOICE),
      channel("random"),
    ];
    expect(defaultChannelChoices(channels).map((c) => c.id)).toEqual([
      "general",
      "random",
    ]);
  });

  // Only TEXT is offered, so a kind the client doesn't know is left out
  // rather than let through.
  it("offers nothing for a list with no text channels", () => {
    const channels = [
      channel("lounge", ChannelKind.VOICE),
      channel("ada", ChannelKind.DM),
      channel("odd", ChannelKind.UNSPECIFIED),
    ];
    expect(defaultChannelChoices(channels)).toEqual([]);
  });

  it("offers nothing for an empty list", () => {
    expect(defaultChannelChoices([])).toEqual([]);
  });
});

describe("landingChannel", () => {
  const channels = [channel("general"), channel("random")];

  it("opens the space's default when it is in the list", () => {
    expect(landingChannel(space("random"), channels)?.id).toBe("random");
  });

  it("opens the first channel when the space has no default", () => {
    expect(landingChannel(space(), channels)?.id).toBe("general");
  });

  // The id alone never decides: a default deleted while this client was
  // offline still sits on the space row, and following it would land
  // someone on a channel that isn't there.
  it("opens the first channel when the default is not in the list", () => {
    expect(landingChannel(space("deleted"), channels)?.id).toBe("general");
  });

  it("opens the first channel when the space itself hasn't loaded", () => {
    expect(landingChannel(undefined, channels)?.id).toBe("general");
  });

  it("opens the only channel there is", () => {
    expect(landingChannel(space(), [channel("general")])?.id).toBe("general");
  });

  it("opens nothing for an empty list", () => {
    expect(landingChannel(space("general"), [])).toBeUndefined();
  });

  it("opens nothing while the channel list is cold", () => {
    expect(landingChannel(space("general"), undefined)).toBeUndefined();
  });

  // Arriving in a voice channel joins the room, which is why
  // defaultChannelChoices excludes voice. The fallback used to take
  // position 0 whatever its kind, so a space whose first channel is voice
  // sent every arrival into it.
  it("skips a voice channel that sorts first", () => {
    const withVoice = [channel("lounge", ChannelKind.VOICE), ...channels];
    const landed = landingChannel(space(), withVoice);
    expect(landed?.kind).toBe(ChannelKind.TEXT);
    expect(landed?.name).toBe("general");
  });

  // Nothing else to offer. "No channels yet" would be a lie to someone
  // looking at a list of channels, so this one still lands in voice.
  it("lands in voice when a space has nothing else", () => {
    const voiceOnly = [channel("lounge", ChannelKind.VOICE)];
    expect(landingChannel(space(), voiceOnly)?.name).toBe("lounge");
  });
});
