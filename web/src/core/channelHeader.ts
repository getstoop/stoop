import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";

// The header a channel screen shows beside its messages, and what a
// realtime event does to it. The mobile app's channel screen holds one
// over its channel log (core/channelLog); web reads the same facts from
// its query cache.

// The channel and its space for the title, how many can read it (the
// space's members, or a private channel's), and who is reading.
export type ChannelHeader = {
  space: Space;
  channel: Channel;
  memberCount: number;
  myUserId: string;
};

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

// The header after a live event: a rename of the channel or its space, a
// member coming or going, the reader's own role changing, or their mute
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
    case "channelUpdated": {
      if (payload.value.id !== channel.id) return header;
      const { name, private: closed, topic, postPolicy } = payload.value;
      return {
        ...header,
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

function withMemberCount(header: ChannelHeader, change: number) {
  return { ...header, memberCount: Math.max(0, header.memberCount + change) };
}
