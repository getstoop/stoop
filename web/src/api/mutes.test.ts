import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { channelMuted, isMuted, spaceMuted } from "./mutes";

const channel = (id: string, muted = false): Channel =>
  ({ id, muted }) as Channel;

const dm = (c: Channel): DirectMessage =>
  ({ channel: c, participants: [] }) as unknown as DirectMessage;

const space = (id: string, muted = false): Space => ({ id, muted }) as Space;

describe("spaceMuted", () => {
  it("reads the caller's own row off the spaces list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["spaces"], [space("hq", true), space("book-club")]);
    expect(spaceMuted(qc, "hq")).toBe(true);
    expect(spaceMuted(qc, "book-club")).toBe(false);
  });

  it("is undefined while the spaces list is cold", () => {
    expect(spaceMuted(new QueryClient(), "hq")).toBeUndefined();
  });

  // A loaded list that doesn't hold the space is an answer, not a gap: it
  // is not muted for this caller.
  it("is unmuted for a space missing from a loaded list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["spaces"], [space("hq", true)]);
    expect(spaceMuted(qc, "book-club")).toBe(false);
  });
});

describe("channelMuted", () => {
  it("reads a space's channel off that space's list", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["channels", "hq"],
      [channel("general", true), channel("random")],
    );
    expect(channelMuted(qc, "hq", "general")).toBe(true);
    expect(channelMuted(qc, "hq", "random")).toBe(false);
  });

  it("is undefined while the space's channel list is cold", () => {
    expect(channelMuted(new QueryClient(), "hq", "general")).toBeUndefined();
  });

  it("is unmuted for a channel missing from a loaded list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["channels", "hq"], [channel("general", true)]);
    expect(channelMuted(qc, "hq", "gone")).toBe(false);
  });

  // No space means a direct message, which lives in its own list.
  it("reads a channel with no space off the direct message list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], [dm(channel("ada", true)), dm(channel("bea"))]);
    expect(channelMuted(qc, "", "ada")).toBe(true);
    expect(channelMuted(qc, "", "bea")).toBe(false);
  });

  it("is undefined while the direct message list is cold", () => {
    expect(channelMuted(new QueryClient(), "", "ada")).toBeUndefined();
  });

  it("is unmuted for a conversation missing from a loaded list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["dms"], [dm(channel("ada", true))]);
    expect(channelMuted(qc, "", "cal")).toBe(false);
  });

  it("does not look in the space's list for a channel with no space", () => {
    const qc = new QueryClient();
    qc.setQueryData(["channels", ""], [channel("ada", true)]);
    expect(channelMuted(qc, "", "ada")).toBeUndefined();
  });
});

describe("isMuted", () => {
  type State = boolean | "cold";

  const cache = (spaceState: State, channelState: State) => {
    const qc = new QueryClient();
    if (spaceState !== "cold") {
      qc.setQueryData(["spaces"], [space("hq", spaceState)]);
    }
    if (channelState !== "cold") {
      qc.setQueryData(["channels", "hq"], [channel("general", channelState)]);
    }
    return qc;
  };

  // The whole space-mute × channel-mute matrix, cold rows included. A
  // mute anywhere wins, and only a cache that could still hide a mute
  // answers undefined — ws.ts and unreads.ts both branch on that.
  const matrix: [State, State, boolean | undefined][] = [
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
    [false, "cold", undefined],
    [true, "cold", true],
    ["cold", false, undefined],
    ["cold", true, true],
    ["cold", "cold", undefined],
  ];

  it.each(matrix)(
    "space %s + channel %s is %s",
    (spaceState, channelState, want) => {
      expect(isMuted(cache(spaceState, channelState), "hq", "general")).toBe(
        want,
      );
    },
  );

  it("is unmuted for a channel missing from two loaded lists", () => {
    const qc = cache(false, false);
    expect(isMuted(qc, "hq", "gone")).toBe(false);
  });

  // A mute the caller can see beats a list they cannot: no need to wait
  // for the spaces list to decide a muted channel is quiet.
  it("answers from the channel alone without consulting a cold space", () => {
    const qc = new QueryClient();
    qc.setQueryData(["channels", "hq"], [channel("general", true)]);
    expect(isMuted(qc, "hq", "general")).toBe(true);
  });

  describe("a direct message, which has no space", () => {
    it("follows its own row", () => {
      const qc = new QueryClient();
      qc.setQueryData(["dms"], [dm(channel("ada", true)), dm(channel("bea"))]);
      expect(isMuted(qc, "", "ada")).toBe(true);
      expect(isMuted(qc, "", "bea")).toBe(false);
    });

    it("is undefined while the list is cold", () => {
      expect(isMuted(new QueryClient(), "", "ada")).toBeUndefined();
    });

    // No space row is consulted, so a cold spaces list cannot make a
    // loaded conversation undecidable.
    it("is decided even with no spaces list at all", () => {
      const qc = new QueryClient();
      qc.setQueryData(["dms"], [dm(channel("ada"))]);
      expect(isMuted(qc, "", "ada")).toBe(false);
    });
  });
});
