import { describe, expect, it, vi } from "vitest";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import {
  byPosition,
  defaultChannelChoices,
  landingChannel,
  withPositions,
} from "./channels";

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

describe("withPositions", () => {
  const at = (id: string, position: number, seconds = 0, nanos = 0): Channel =>
    ({
      id,
      name: id,
      kind: ChannelKind.TEXT,
      position,
      createdAt: { seconds: BigInt(seconds), nanos },
    }) as Channel;
  const ids = (channels: Channel[]) => channels.map((c) => c.id);

  it("moves the channels the space was told about and keeps a private one in its place", () => {
    // The sidebar of someone in a private channel: general, captains, garden.
    const mine = [at("general", 0), at("captains", 1), at("garden", 2)];
    // The space hears about its public channels only: garden first.
    const told = [
      { id: "garden", position: 0 },
      { id: "general", position: 2 },
    ];
    expect(ids(withPositions(mine, told))).toEqual([
      "garden",
      "captains",
      "general",
    ]);
  });

  it("ignores a channel the list does not hold", () => {
    const mine = [at("general", 0), at("garden", 1)];
    expect(
      ids(withPositions(mine, [{ id: "elsewhere", position: 0 }])),
    ).toEqual(["general", "garden"]);
  });

  it("orders equal positions oldest first, as the server does", () => {
    expect(
      ids(byPosition([at("newer", 0, 20), at("older", 0, 10), at("last", 1)])),
    ).toEqual(["older", "newer", "last"]);
  });
});

describe("byPosition", () => {
  it("orders channels made in the same second by the fraction of it", () => {
    const made = (id: string, nanos: number): Channel =>
      ({
        id,
        name: id,
        kind: ChannelKind.TEXT,
        position: 0,
        createdAt: { seconds: 10n, nanos },
      }) as Channel;
    expect(
      byPosition([made("second", 500), made("first", 100)]).map((c) => c.id),
    ).toEqual(["first", "second"]);
  });
});

describe("a private channel", () => {
  it("is never offered as the channel new members start in", () => {
    const hidden = { ...channel("captains"), private: true } as Channel;
    expect(defaultChannelChoices([channel("general"), hidden])).toEqual([
      channel("general"),
    ]);
  });
});
