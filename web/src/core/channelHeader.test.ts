import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import { ChannelSchema } from "../gen/stoop/chat/v1/channel_pb";
import { SpaceRole, SpaceSchema } from "../gen/stoop/chat/v1/space_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import {
  type ChannelHeader,
  losesChannel,
  withHeaderEvent,
} from "./channelHeader";

const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

const header = (init: Partial<ChannelHeader> = {}): ChannelHeader => ({
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, { id: "c1", name: "general" }),
  memberCount: 3,
  myUserId: "me",
  ...init,
});

describe("losesChannel", () => {
  it("is the channel or its space deleted, or the reader taken out", () => {
    const loses = (payload: Parameters<typeof event>[0]) =>
      losesChannel(event(payload), "s1", "c1", "me");
    expect(loses({ case: "channelDeleted", value: { channelId: "c1" } })).toBe(
      true,
    );
    expect(loses({ case: "channelDeleted", value: { channelId: "c2" } })).toBe(
      false,
    );
    expect(loses({ case: "spaceDeleted", value: { spaceId: "s1" } })).toBe(
      true,
    );
    expect(
      loses({ case: "memberRemoved", value: { spaceId: "s1", userId: "me" } }),
    ).toBe(true);
    expect(
      loses({ case: "memberRemoved", value: { spaceId: "s1", userId: "dee" } }),
    ).toBe(false);
    expect(
      loses({
        case: "channelMemberLeft",
        value: { channelId: "c1", userId: "me" },
      }),
    ).toBe(true);
  });
});

describe("withHeaderEvent", () => {
  it("follows a rename of the channel and of its space", () => {
    const renamed = withHeaderEvent(
      header(),
      event({
        case: "channelUpdated",
        value: create(ChannelSchema, { id: "c1", name: "lobby" }),
      }),
    );
    expect(renamed.channel.name).toBe("lobby");
    const moved = withHeaderEvent(
      renamed,
      event({
        case: "spaceUpdated",
        value: { space: create(SpaceSchema, { id: "s1", name: "The Yard" }) },
      }),
    );
    expect(moved.space.name).toBe("The Yard");
    expect(moved.channel.name).toBe("lobby");
  });

  it("keeps the reader's role and permissions through a space update", () => {
    const held = header({
      space: create(SpaceSchema, {
        id: "s1",
        name: "The Porch",
        myRole: SpaceRole.ADMIN,
        myPermissions: [Permission.MESSAGES_MODERATE],
      }),
    });
    // A broadcast space says nothing about who is reading.
    const updated = withHeaderEvent(
      held,
      event({
        case: "spaceUpdated",
        value: { space: create(SpaceSchema, { id: "s1", name: "The Yard" }) },
      }),
    );
    expect(updated.space.name).toBe("The Yard");
    expect(updated.space.myRole).toBe(SpaceRole.ADMIN);
    expect(updated.space.myPermissions).toEqual([Permission.MESSAGES_MODERATE]);
  });

  it("follows the reader's mute of the channel, and not another's", () => {
    const muted = withHeaderEvent(
      header(),
      event({
        case: "channelMuted",
        value: { spaceId: "s1", channelId: "c1", muted: true },
      }),
    );
    expect(muted.channel.muted).toBe(true);
    const held = header();
    expect(
      withHeaderEvent(
        held,
        event({
          case: "channelMuted",
          value: { spaceId: "s1", channelId: "c2", muted: true },
        }),
      ),
    ).toBe(held);
  });

  it("takes the reader's new role, and nobody else's", () => {
    const demoted = withHeaderEvent(
      header(),
      event({
        case: "memberRoleChanged",
        value: { spaceId: "s1", userId: "me", role: SpaceRole.ADMIN },
      }),
    );
    expect(demoted.space.myRole).toBe(SpaceRole.ADMIN);
    const held = header();
    expect(
      withHeaderEvent(
        held,
        event({
          case: "memberRoleChanged",
          value: { spaceId: "s1", userId: "dee", role: SpaceRole.ADMIN },
        }),
      ),
    ).toBe(held);
  });

  it("is the same header for another channel's rename, or an unrelated event", () => {
    const held = header();
    expect(
      withHeaderEvent(
        held,
        event({
          case: "channelUpdated",
          value: create(ChannelSchema, { id: "c2", name: "lobby" }),
        }),
      ),
    ).toBe(held);
    expect(
      withHeaderEvent(
        held,
        event({ case: "channelRead", value: { channelId: "c1" } }),
      ),
    ).toBe(held);
  });

  it("counts the space's members coming and going", () => {
    const joined = withHeaderEvent(
      header(),
      event({ case: "memberJoined", value: { spaceId: "s1", userId: "dee" } }),
    );
    expect(joined.memberCount).toBe(4);
    const left = withHeaderEvent(
      joined,
      event({ case: "memberRemoved", value: { spaceId: "s1", userId: "dee" } }),
    );
    expect(left.memberCount).toBe(3);
    expect(
      withHeaderEvent(
        left,
        event({
          case: "memberJoined",
          value: { spaceId: "s2", userId: "dee" },
        }),
      ),
    ).toBe(left);
  });

  it("counts a private channel's own members, not the space's", () => {
    const closed = header({
      channel: create(ChannelSchema, { id: "c1", private: true }),
    });
    expect(
      withHeaderEvent(
        closed,
        event({
          case: "memberJoined",
          value: { spaceId: "s1", userId: "dee" },
        }),
      ),
    ).toBe(closed);
    expect(
      withHeaderEvent(
        closed,
        event({
          case: "channelMemberJoined",
          value: { channelId: "c1", userId: "dee" },
        }),
      ).memberCount,
    ).toBe(4);
    expect(
      withHeaderEvent(
        header(),
        event({
          case: "channelMemberJoined",
          value: { channelId: "c1", userId: "dee" },
        }),
      ).memberCount,
    ).toBe(3);
  });
});
