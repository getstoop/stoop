import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import {
  applyMemberJoined,
  applyMemberLeft,
  applyRequired,
  knownOutside,
} from "./membership";
import { inChannel, isAlerting } from "./unreads";

// ./unreads reaches ./dms → ./clients, which builds its transport from
// location.origin at import time; the node environment has no location.
vi.hoisted(() => {
  (globalThis as { location?: unknown }).location = new URL(
    "http://localhost/",
  );
});

const text = (id: string, joined: boolean, extra: Partial<Channel> = {}) =>
  ({
    id,
    kind: ChannelKind.TEXT,
    joined,
    memberCount: 3,
    muted: false,
    unreadCount: 0,
    lastMessageId: "",
    lastReadMessageId: "",
    ...extra,
  }) as Channel;

const seeded = (channels: Channel[] | undefined) => {
  const queryClient = new QueryClient();
  if (channels) queryClient.setQueryData(["channels", "hq"], channels);
  queryClient.setQueryData<Space[]>(
    ["spaces"],
    [{ id: "hq", muted: false, hasUnread: true } as Space],
  );
  return queryClient;
};

const listed = (queryClient: QueryClient, id: string) =>
  queryClient
    .getQueryData<Channel[]>(["channels", "hq"])
    ?.find((channel) => channel.id === id);

const stale = (queryClient: QueryClient, key: unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated ?? false;

describe("inChannel", () => {
  it("follows joined for a text channel", () => {
    expect(inChannel(text("a", true))).toBe(true);
    expect(inChannel(text("a", false))).toBe(false);
  });

  it("is always true for a voice channel and a direct message", () => {
    expect(
      inChannel({ kind: ChannelKind.VOICE, joined: false } as Channel),
    ).toBe(true);
    expect(inChannel({ kind: ChannelKind.DM, joined: false } as Channel)).toBe(
      true,
    );
  });

  it("keeps a channel they are not in from alerting", () => {
    const queryClient = seeded([]);
    const unread = { lastMessageId: "2", lastReadMessageId: "1" };
    expect(isAlerting(queryClient, "hq", text("a", true, unread))).toBe(true);
    expect(isAlerting(queryClient, "hq", text("a", false, unread))).toBe(false);
  });
});

describe("knownOutside", () => {
  it("is true only for a listed channel they are not in", () => {
    const queryClient = seeded([text("in", true), text("out", false)]);
    expect(knownOutside(queryClient, "hq", "out")).toBe(true);
    expect(knownOutside(queryClient, "hq", "in")).toBe(false);
    expect(knownOutside(queryClient, "hq", "gone")).toBe(false);
  });

  it("is false while the list is not loaded", () => {
    expect(knownOutside(seeded(undefined), "hq", "out")).toBe(false);
  });
});

describe("applyMemberJoined", () => {
  const event = { spaceId: "hq", channelId: "garden", userId: "bea" };

  it("counts someone else in and leaves the caller's row alone", () => {
    const queryClient = seeded([text("garden", false)]);
    applyMemberJoined(queryClient, event, "ada");
    expect(listed(queryClient, "garden")).toMatchObject({
      joined: false,
      memberCount: 4,
    });
    expect(stale(queryClient, ["channels", "hq"])).toBe(false);
  });

  it("puts the caller in and asks the server for the rest", () => {
    const queryClient = seeded([text("garden", false)]);
    applyMemberJoined(queryClient, event, "bea");
    expect(listed(queryClient, "garden")).toMatchObject({
      joined: true,
      memberCount: 4,
    });
    expect(stale(queryClient, ["channels", "hq"])).toBe(true);
    expect(stale(queryClient, ["spaces"])).toBe(true);
  });
});

describe("applyMemberLeft", () => {
  const event = { spaceId: "hq", channelId: "garden", userId: "bea" };
  const unread = { lastMessageId: "2", lastReadMessageId: "1", unreadCount: 1 };

  it("counts someone else out", () => {
    const queryClient = seeded([text("garden", true, unread)]);
    applyMemberLeft(queryClient, event, "ada");
    expect(listed(queryClient, "garden")).toMatchObject({
      joined: true,
      memberCount: 2,
      unreadCount: 1,
    });
  });

  it("takes the caller out, with the mute and the unread state", () => {
    const queryClient = seeded([
      text("garden", true, { ...unread, muted: true }),
    ]);
    applyMemberLeft(queryClient, event, "bea");
    expect(listed(queryClient, "garden")).toMatchObject({
      joined: false,
      muted: false,
      unreadCount: 0,
      memberCount: 2,
    });
  });

  it("clears the space's dot when that was its only unread channel", () => {
    const queryClient = seeded([text("garden", true, unread)]);
    applyMemberLeft(queryClient, event, "bea");
    expect(queryClient.getQueryData<Space[]>(["spaces"])?.[0].hasUnread).toBe(
      false,
    );
  });
});

describe("applyRequired", () => {
  it("refetches when the caller was not in the channel", () => {
    const queryClient = seeded([text("garden", false)]);
    applyRequired(queryClient, "hq", "garden");
    expect(stale(queryClient, ["channels", "hq"])).toBe(true);
  });

  it("does nothing when they already were", () => {
    const queryClient = seeded([text("garden", true)]);
    applyRequired(queryClient, "hq", "garden");
    expect(stale(queryClient, ["channels", "hq"])).toBe(false);
  });
});
