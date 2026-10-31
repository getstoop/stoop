import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { Permission } from "../gen/stoop/access/v1/access_pb";
import { ChannelKind, ChannelSchema } from "../gen/stoop/chat/v1/channel_pb";
import { DirectMessageSchema } from "../gen/stoop/chat/v1/chat_pb";
import { GroupSchema } from "../gen/stoop/chat/v1/group_pb";
import { MemberSchema } from "../gen/stoop/chat/v1/member_pb";
import { SpaceRole, SpaceSchema } from "../gen/stoop/chat/v1/space_pb";
import {
  type ServerEvent,
  ServerEventSchema,
} from "../gen/stoop/realtime/v1/realtime_pb";
import {
  type ChannelHeader,
  changesMentionNames,
  headerBeginning,
  headerMentionNames,
  headerPlace,
  losesChannel,
  withHeaderEvent,
} from "./channelHeader";
import { linkableChannels, NO_CHANNELS } from "./mentions";

const event = (
  payload: MessageInitShape<typeof ServerEventSchema>["payload"],
): ServerEvent => create(ServerEventSchema, { payload });

const header = (init: Partial<ChannelHeader> = {}): ChannelHeader => ({
  space: create(SpaceSchema, { id: "s1", name: "The Porch" }),
  channel: create(ChannelSchema, { id: "c1", name: "general" }),
  memberCount: 3,
  members: [],
  groups: [],
  myUserId: "me",
  channels: NO_CHANNELS,
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
    expect(moved.space?.name).toBe("The Yard");
    expect(moved.channel.name).toBe("lobby");
  });

  it("keeps the channels a link opens current", () => {
    const text = (id: string, name: string, more = {}) =>
      create(ChannelSchema, {
        id,
        spaceId: "s1",
        name,
        kind: ChannelKind.TEXT,
        ...more,
      });
    const start = header({
      channels: linkableChannels([text("c1", "general"), text("c2", "books")]),
    });
    const names = (held: ChannelHeader) =>
      [...held.channels.values()].map((channel) => channel.name);

    const made = withHeaderEvent(
      start,
      event({ case: "channelCreated", value: text("c3", "random") }),
    );
    expect(names(made)).toEqual(["general", "books", "random"]);

    const renamed = withHeaderEvent(
      made,
      event({ case: "channelUpdated", value: text("c2", "novels") }),
    );
    expect(names(renamed)).toEqual(["general", "novels", "random"]);

    // Made private, it is no longer one a link opens.
    const closed = withHeaderEvent(
      renamed,
      event({
        case: "channelUpdated",
        value: text("c3", "random", { private: true }),
      }),
    );
    expect(names(closed)).toEqual(["general", "novels"]);

    const deleted = withHeaderEvent(
      closed,
      event({
        case: "channelDeleted",
        value: { spaceId: "s1", channelId: "c2" },
      }),
    );
    expect(names(deleted)).toEqual(["general"]);

    // The shown channel, made private: its own entry goes, and the
    // header says it is private, which is what its reader checks.
    const own = withHeaderEvent(
      deleted,
      event({
        case: "channelUpdated",
        value: text("c1", "general", { private: true }),
      }),
    );
    expect(own.channel.private).toBe(true);
    expect(names(own)).toEqual([]);

    // Another space's channels and a voice channel change nothing.
    const elsewhere = withHeaderEvent(
      start,
      event({
        case: "channelCreated",
        value: text("c9", "elsewhere", { spaceId: "s2" }),
      }),
    );
    expect(elsewhere).toBe(start);
    const voice = withHeaderEvent(
      start,
      event({
        case: "channelCreated",
        value: text("c8", "lounge", { kind: ChannelKind.VOICE }),
      }),
    );
    expect(voice).toBe(start);
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
    expect(updated.space?.name).toBe("The Yard");
    expect(updated.space?.myRole).toBe(SpaceRole.ADMIN);
    expect(updated.space?.myPermissions).toEqual([
      Permission.MESSAGES_MODERATE,
    ]);
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
    expect(demoted.space?.myRole).toBe(SpaceRole.ADMIN);
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

describe("headerMentionNames", () => {
  const members = [create(MemberSchema, { userId: "u1", username: "ada" })];
  const groups = [create(GroupSchema, { id: "g1", handle: "crew" })];
  const channels = linkableChannels([
    create(ChannelSchema, { id: "c2", name: "garden", kind: ChannelKind.TEXT }),
  ]);

  it("names the people, groups and channels of a public channel", () => {
    const names = headerMentionNames(header({ members, groups, channels }));
    expect([...names.members.keys()]).toEqual(["u1"]);
    expect([...names.groups.keys()]).toEqual(["g1"]);
    expect([...names.channels.keys()]).toEqual(["c2"]);
  });

  it("names only the people of a private channel", () => {
    const names = headerMentionNames(
      header({
        channel: create(ChannelSchema, { id: "c1", private: true }),
        members,
        groups,
        channels,
      }),
    );
    expect([...names.members.keys()]).toEqual(["u1"]);
    expect(names.groups.size).toBe(0);
    expect(names.channels.size).toBe(0);
  });
});

describe("changesMentionNames", () => {
  const changes = (payload: Parameters<typeof event>[0], closed = false) =>
    changesMentionNames(event(payload), "s1", "c1", closed);

  it("is someone joining, leaving or renamed in the space, or its groups", () => {
    for (const kind of ["memberJoined", "memberUpdated", "memberRemoved"]) {
      const value = { spaceId: "s1", userId: "u2" };
      expect(
        changes({ case: kind, value } as Parameters<typeof event>[0]),
      ).toBe(true);
      expect(
        changes({
          case: kind,
          value: { ...value, spaceId: "s2" },
        } as Parameters<typeof event>[0]),
      ).toBe(false);
    }
    expect(changes({ case: "groupsChanged", value: { spaceId: "s1" } })).toBe(
      true,
    );
    expect(changes({ case: "groupsChanged", value: { spaceId: "s2" } })).toBe(
      false,
    );
  });

  it("is someone joining or leaving the channel, when it is private", () => {
    const joined = {
      case: "channelMemberJoined" as const,
      value: { channelId: "c1", userId: "u2" },
    };
    expect(changes(joined, true)).toBe(true);
    expect(changes(joined)).toBe(false);
    expect(
      changes(
        { case: "channelMemberLeft", value: { channelId: "c2", userId: "u2" } },
        true,
      ),
    ).toBe(false);
  });

  it("is nothing else", () => {
    expect(
      changes({ case: "channelDeleted", value: { channelId: "c1" } }),
    ).toBe(false);
  });
});

describe("a direct message's header", () => {
  const person = (id: string, displayName: string) => ({
    id,
    username: id,
    displayName,
  });
  const conversation = (...others: ReturnType<typeof person>[]) =>
    header({
      space: undefined,
      channel: create(ChannelSchema, { id: "d1", name: "" }),
      dm: create(DirectMessageSchema, {
        participants: [person("me", "Me"), ...others],
      }),
    });

  it("is named after who it is with, and a channel by its #name", () => {
    expect(headerPlace(conversation(person("sam", "Sam Ortiz")))).toBe(
      "Sam Ortiz",
    );
    expect(headerPlace(header())).toBe("#general");
    expect(headerBeginning(conversation(person("sam", "Sam Ortiz")))).toBe(
      "This is the beginning of your conversation with Sam Ortiz.",
    );
    expect(
      headerBeginning(
        conversation(person("june", "June"), person("theo", "Theo")),
      ),
    ).toBe("This is the beginning of this conversation.");
    expect(headerBeginning(header())).toBe(
      "This is the beginning of #general.",
    );
  });

  // DM events carry an empty space_id: another conversation starting is
  // not a channel a link here could open.
  it("takes no space's events, nor another conversation as a channel", () => {
    const dm = conversation(person("sam", "Sam Ortiz"));
    const events: Parameters<typeof event>[0][] = [
      {
        case: "channelCreated",
        value: { id: "d2", spaceId: "", kind: ChannelKind.TEXT },
      },
      { case: "channelDeleted", value: { channelId: "d2", spaceId: "" } },
      { case: "memberJoined", value: { spaceId: "" } },
      {
        case: "memberRoleChanged",
        value: { spaceId: "", userId: "me", role: SpaceRole.ADMIN },
      },
      {
        case: "spaceUpdated",
        value: { space: create(SpaceSchema, { id: "" }) },
      },
    ];
    for (const payload of events) {
      expect(withHeaderEvent(dm, event(payload))).toBe(dm);
    }
  });

  it("still follows its own channel's mute", () => {
    const dm = conversation(person("sam", "Sam Ortiz"));
    const muted = withHeaderEvent(
      dm,
      event({ case: "channelMuted", value: { channelId: "d1", muted: true } }),
    );
    expect(muted.channel.muted).toBe(true);
  });
});
