import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "../gen/stoop/realtime/v1/realtime_pb";
import { losesChannel, type Page, withChannelEvent } from "./channelTimeline";

// What a realtime event does to what a channel's timeline holds
// (timelineState): its window of messages, and the header it may carry
// beside them. A timeline that gets the header elsewhere, or a thread's,
// carries none.

// The channel and its space for the title, how many can read it (the
// space's members, or a private channel's), and who is reading.
export type ChannelHeader = {
  space: Space;
  channel: Channel;
  memberCount: number;
  myUserId: string;
};

export type Header = ChannelHeader | undefined;

export type Held<H extends Header> = {
  channelId: string;
  page: Page;
  header: H;
};

// The window and header after an event, the same object when it is about
// something else, or null when it means the reader can no longer see the
// channel. A replay (live false) of an event over an answer leaves the
// member count alone: the answer may have counted them already, and unlike
// the rest a count isn't safe to apply twice.
export function withTimelineEvent<T extends Held<Header>>(
  held: T,
  event: ServerEvent,
  live: boolean,
): T | null {
  const { header, channelId, page } = held;
  if (losesTimeline(header, event, channelId)) return null;
  const nextHeader: T["header"] = header
    ? withHeaderEvent(header, event, live)
    : header;
  const messages = withChannelEvent(page.messages, event, channelId);
  if (nextHeader === header && messages === page.messages) return held;
  return { ...held, header: nextHeader, page: { ...page, messages } };
}

// With no header, only the channel's deletion says it is lost.
function losesTimeline(
  header: Header,
  event: ServerEvent,
  channelId: string,
): boolean {
  if (header)
    return losesChannel(
      event,
      header.space.id,
      header.channel.id,
      header.myUserId,
    );
  return (
    event.payload.case === "channelDeleted" &&
    event.payload.value.channelId === channelId
  );
}

// A rename of the channel or its space, or a member coming or going.
function withHeaderEvent(
  header: ChannelHeader,
  event: ServerEvent,
  live: boolean,
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
    case "spaceUpdated":
      if (!payload.value.space || payload.value.space.id !== space.id)
        return header;
      return { ...header, space: payload.value.space };
    case "memberJoined":
    case "memberRemoved":
      // A private channel's members join and leave it on their own.
      if (!live || channel.private || payload.value.spaceId !== space.id)
        return header;
      return withMemberCount(header, payload.case === "memberJoined" ? 1 : -1);
    case "channelMemberJoined":
    case "channelMemberLeft":
      if (!live || !channel.private || payload.value.channelId !== channel.id)
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
