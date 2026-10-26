import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import type { Member } from "../gen/stoop/chat/v1/member_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import {
  type MentionChannels,
  type MentionNames,
  mentionGroups,
  mentionMembers,
  NO_CHANNELS,
  withLinkableChannel,
  withoutChannel,
} from "./mentions";

// The header a channel screen shows beside its messages, and what a
// realtime event does to it. The mobile app's channel screen holds one
// over its channel log (core/channelLog); web reads the same facts from
// its query cache.

// The channel and its space for the title, how many can read it (the
// space's members, or a private channel's), who is reading, and the
// space's channels a channel link in a message may open
// (linkableChannels), kept current by the channel events. A private
// channel's links open nothing, as on web: its reader checks
// channel.private. And who a mention may name there: the people who can
// read it (the space's members, or a private channel's), and the space's
// groups (none in a private channel), loaded again when they change.
export type ChannelHeader = {
  space: Space;
  channel: Channel;
  memberCount: number;
  myUserId: string;
  channels: MentionChannels;
  members: Member[];
  groups: Group[];
};

// Who and what a handle typed in the channel names: groups and channel
// links only in a public channel, as the server keeps them.
export function headerMentionNames(header: ChannelHeader): MentionNames {
  const closed = header.channel.private;
  return {
    members: mentionMembers(header.members),
    groups: mentionGroups(closed ? [] : header.groups),
    channels: closed ? NO_CHANNELS : header.channels,
  };
}

// Whether an event means the reader can no longer see the channel: it, or
// its space, was deleted, or they were taken out of either.
export function losesChannel(
  event: ServerEvent,
  spaceId: string,
  channelId: string,
  myUserId: string,
): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "channelDeleted":
      return payload.value.channelId === channelId;
    case "spaceDeleted":
      return payload.value.spaceId === spaceId;
    case "memberRemoved":
      return (
        payload.value.spaceId === spaceId && payload.value.userId === myUserId
      );
    case "channelMemberLeft":
      return (
        payload.value.channelId === channelId &&
        payload.value.userId === myUserId
      );
    default:
      return false;
  }
}

// Whether an event changes who a mention may name in the channel: someone
// joining, leaving or renamed in its space, someone joining or leaving it
// when it is private (`closed`; taken as so before the header says), or
// the space's groups changing. The events say who, not what changed, so
// the header is loaded again for it.
export function changesMentionNames(
  event: ServerEvent,
  spaceId: string,
  channelId: string,
  closed: boolean,
): boolean {
  const payload = event.payload;
  switch (payload.case) {
    case "memberJoined":
    case "memberUpdated":
    case "memberRemoved":
    case "groupsChanged":
      return payload.value.spaceId === spaceId;
    case "channelMemberJoined":
    case "channelMemberLeft":
      return closed && payload.value.channelId === channelId;
    default:
      return false;
  }
}

// The header after a live event: a rename of the channel or its space, a
// channel in the space made, changed or deleted, a member coming or going, the reader's own role changing, or their mute
// of the channel (from another device too). The same
// object when the event is about something else. A count is applied only as the event arrives; a header
// fetched afterwards has counted the member already, so it replaces this
// one rather than being patched.
export function withHeaderEvent(
  header: ChannelHeader,
  event: ServerEvent,
): ChannelHeader {
  const { space, channel } = header;
  const payload = event.payload;
  switch (payload.case) {
    case "channelCreated":
      if (payload.value.spaceId !== space.id) return header;
      return withChannels(
        header,
        withLinkableChannel(header.channels, payload.value),
      );
    case "channelDeleted":
      if (payload.value.spaceId !== space.id) return header;
      return withChannels(
        header,
        withoutChannel(header.channels, payload.value.channelId),
      );
    case "channelUpdated": {
      const updated = payload.value;
      const linked =
        updated.spaceId === space.id
          ? withChannels(header, withLinkableChannel(header.channels, updated))
          : header;
      if (updated.id !== channel.id) return linked;
      const { name, private: closed, topic, postPolicy } = updated;
      return {
        ...linked,
        channel: { ...channel, name, private: closed, topic, postPolicy },
      };
    }
    case "spaceUpdated": {
      const updated = payload.value.space;
      if (!updated || updated.id !== space.id) return header;
      // A broadcast space carries nobody's role or permissions
      // (realtime.proto SpaceUpdated), so the held ones stay.
      return {
        ...header,
        space: {
          ...updated,
          myRole: space.myRole,
          myPermissions: space.myPermissions,
        },
      };
    }
    case "memberRoleChanged":
      // The event says the new role, not what it permits: the screen asks
      // for the header again for that (useChannelLog).
      if (
        payload.value.spaceId !== space.id ||
        payload.value.userId !== header.myUserId
      )
        return header;
      return { ...header, space: { ...space, myRole: payload.value.role } };
    case "channelMuted":
      if (
        payload.value.channelId !== channel.id ||
        payload.value.muted === channel.muted
      )
        return header;
      return {
        ...header,
        channel: { ...channel, muted: payload.value.muted },
      };
    case "memberJoined":
    case "memberRemoved":
      // A private channel's members join and leave it on their own.
      if (channel.private || payload.value.spaceId !== space.id) return header;
      return withMemberCount(header, payload.case === "memberJoined" ? 1 : -1);
    case "channelMemberJoined":
    case "channelMemberLeft":
      if (!channel.private || payload.value.channelId !== channel.id)
        return header;
      return withMemberCount(
        header,
        payload.case === "channelMemberJoined" ? 1 : -1,
      );
    default:
      return header;
  }
}

function withChannels(header: ChannelHeader, channels: MentionChannels) {
  return channels === header.channels ? header : { ...header, channels };
}

function withMemberCount(header: ChannelHeader, change: number) {
  return { ...header, memberCount: Math.max(0, header.memberCount + change) };
}
