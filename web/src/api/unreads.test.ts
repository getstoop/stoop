import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import {
  badgeCount,
  isAlerting,
  isUnread,
  patchChannel,
  recomputeSpaceUnread,
  setSpaceUnread,
} from "./unreads";

// This module reaches ./dms → ./clients, which builds its transport from
// location.origin at import time; the node environment has no location.
vi.hoisted(() => {
  (globalThis as { location?: unknown }).location = new URL(
    "http://localhost/",
  );
});

const channel = (
  id: string,
  lastMessageId = "",
  lastReadMessageId = "",
  muted = false,
): Channel =>
  ({ id, lastMessageId, lastReadMessageId, muted, unreadCount: 0 }) as Channel;

const dm = (c: Channel): DirectMessage =>
  ({ channel: c, participants: [] }) as unknown as DirectMessage;

const space = (id: string, muted = false, hasUnread = false): Space =>
  ({ id, muted, hasUnread }) as Space;

describe("badgeCount", () => {
  it("shows the number as-is up to the cap", () => {
    expect(badgeCount(0)).toBe("0");
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(99)).toBe("99");
  });

  it("caps past 99", () => {
    expect(badgeCount(100)).toBe("99+");
    expect(badgeCount(4321)).toBe("99+");
  });
});

describe("isUnread", () => {
  it("is unread when the last message is newer than the last read", () => {
    expect(isUnread(channel("general", "02", "01"))).toBe(true);
  });

  it("is read once the marks match", () => {
    expect(isUnread(channel("general", "02", "02"))).toBe(false);
  });

  it("is unread when the channel was never read", () => {
    expect(isUnread(channel("general", "01"))).toBe(true);
  });

  it("is read when the channel has no messages at all", () => {
    expect(isUnread(channel("general"))).toBe(false);
  });

  // A stale read mark ahead of the last message (a deletion, say) must not
  // bold the row.
  it("is read when the read mark is ahead", () => {
    expect(isUnread(channel("general", "01", "02"))).toBe(false);
  });
});

describe("isAlerting", () => {
  const unread = channel("general", "02", "01");

  it("alerts on an unread channel with nothing muted", () => {
    const qc = new QueryClient();
    qc.setQueryData(["channels", "s1"], [unread]);
    qc.setQueryData(["spaces"], [space("s1")]);
    expect(isAlerting(qc, "s1", unread)).toBe(true);
  });

  it("stays quiet when the channel is muted", () => {
    const qc = new QueryClient();
    qc.setQueryData(["channels", "s1"], [channel("general", "02", "01", true)]);
    qc.setQueryData(["spaces"], [space("s1")]);
    expect(isAlerting(qc, "s1", unread)).toBe(false);
  });

  it("stays quiet when the whole space is muted", () => {
    const qc = new QueryClient();
    qc.setQueryData(["channels", "s1"], [unread]);
    qc.setQueryData(["spaces"], [space("s1", true)]);
    expect(isAlerting(qc, "s1", unread)).toBe(false);
  });

  it("does not alert on a read channel", () => {
    const qc = new QueryClient();
    const read = channel("general", "02", "02");
    qc.setQueryData(["channels", "s1"], [read]);
    qc.setQueryData(["spaces"], [space("s1")]);
    expect(isAlerting(qc, "s1", read)).toBe(false);
  });

  // A cold cache cannot prove a mute, and a badge you did get beats one
  // you did not.
  it("alerts while the mute rows are still unloaded", () => {
    expect(isAlerting(new QueryClient(), "s1", unread)).toBe(true);
  });
});

describe("patchChannel", () => {
  it("patches only the named channel in a space", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["channels", "s1"],
      [channel("general", "02", "01"), channel("random", "05", "04")],
    );
    patchChannel(qc, "s1", "general", { lastReadMessageId: "02" });
    const channels = qc.getQueryData<Channel[]>(["channels", "s1"]);
    expect(channels?.map((c) => c.lastReadMessageId)).toEqual(["02", "04"]);
  });

  it("passes the current channel to a function patch", () => {
    const qc = new QueryClient();
    qc.setQueryData(["channels", "s1"], [channel("general", "07", "01")]);
    patchChannel(qc, "s1", "general", (c) => ({
      lastReadMessageId: c.lastMessageId,
    }));
    expect(
      qc.getQueryData<Channel[]>(["channels", "s1"])?.[0].lastReadMessageId,
    ).toBe("07");
  });

  it("leaves an unloaded channel list alone", () => {
    const qc = new QueryClient();
    patchChannel(qc, "s1", "general", { unreadCount: 3 });
    expect(qc.getQueryData(["channels", "s1"])).toBeUndefined();
  });

  it("routes a channel with no space to the direct message list", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["dms"],
      [dm(channel("ada", "02", "01")), dm(channel("bea", "09", "09"))],
    );
    patchChannel(qc, "", "ada", { lastReadMessageId: "02" });
    const dms = qc.getQueryData<DirectMessage[]>(["dms"]);
    expect(dms?.map((d) => d.channel?.id)).toEqual(["bea", "ada"]); // resorted
    expect(dms?.find((d) => d.channel?.id === "ada")?.channel).toMatchObject({
      lastReadMessageId: "02",
    });
  });
});

describe("setSpaceUnread", () => {
  it("flips the flag on the named space only", () => {
    const qc = new QueryClient();
    qc.setQueryData(["spaces"], [space("s1"), space("s2")]);
    setSpaceUnread(qc, "s1", true);
    expect(
      qc.getQueryData<Space[]>(["spaces"])?.map((s) => s.hasUnread),
    ).toEqual([true, false]);
  });

  it("ignores the direct message pseudo-space", () => {
    const qc = new QueryClient();
    qc.setQueryData(["spaces"], [space("s1", false, true)]);
    setSpaceUnread(qc, "", false);
    expect(qc.getQueryData<Space[]>(["spaces"])?.[0].hasUnread).toBe(true);
  });
});

describe("recomputeSpaceUnread", () => {
  it("keeps the space unread while another channel still is", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["channels", "s1"],
      [channel("general", "02", "02"), channel("random", "05", "04")],
    );
    qc.setQueryData(["spaces"], [space("s1", false, true)]);
    recomputeSpaceUnread(qc, "s1");
    expect(qc.getQueryData<Space[]>(["spaces"])?.[0].hasUnread).toBe(true);
  });

  it("clears the space once every channel is read", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["channels", "s1"],
      [channel("general", "02", "02"), channel("random", "05", "05")],
    );
    qc.setQueryData(["spaces"], [space("s1", false, true)]);
    recomputeSpaceUnread(qc, "s1");
    expect(qc.getQueryData<Space[]>(["spaces"])?.[0].hasUnread).toBe(false);
  });

  it("does not count a muted channel", () => {
    const qc = new QueryClient();
    qc.setQueryData(
      ["channels", "s1"],
      [channel("general", "02", "02"), channel("random", "05", "04", true)],
    );
    qc.setQueryData(["spaces"], [space("s1", false, true)]);
    recomputeSpaceUnread(qc, "s1");
    expect(qc.getQueryData<Space[]>(["spaces"])?.[0].hasUnread).toBe(false);
  });

  it("refetches the spaces list when the channels are not loaded", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    qc.setQueryData(["spaces"], [space("s1", false, true)]);
    recomputeSpaceUnread(qc, "s1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["spaces"] });
    expect(qc.getQueryData<Space[]>(["spaces"])?.[0].hasUnread).toBe(true);
  });

  it("does nothing for the direct message pseudo-space", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    recomputeSpaceUnread(qc, "");
    expect(invalidate).not.toHaveBeenCalled();
  });
});
