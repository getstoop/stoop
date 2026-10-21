import type { Page } from "@stoop/core/channelTimeline";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { authClient, chatClient } from "./clients";

// A channel's screen: the channel and its space for the title, how many
// people can read it, who is reading (for the "New" line and what
// mentions them), and the newest page of its messages. Older pages load
// as the reader scrolls up; realtime events keep the newest end current
// (core/channelTimeline).

export type ChannelView = Page & {
  space: Space;
  channel: Channel;
  // The space's members, or a private channel's.
  memberCount: number;
  myUserId: string;
};

const TIMEOUT_MS = 10000;
const PAGE = 50;

// The channel's not being in the space's list means it was deleted, or
// the reader can no longer see it.
export class ChannelGone extends Error {}

export async function loadChannel(
  origin: string,
  token: string,
  spaceId: string,
  channelId: string,
): Promise<ChannelView> {
  const chat = chatClient(origin, token);
  const options = { timeoutMs: TIMEOUT_MS };
  const [{ space }, { channels }, { user }, page] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    authClient(origin, token).getMe({}, options),
    chat.listMessages({ channelId, limit: PAGE }, options),
  ]);
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!space || !user) throw new Error("The server answered with nothing.");
  if (!channel) throw new ChannelGone();
  const memberCount = channel.private
    ? (await chat.listChannelMembers({ channelId }, options)).userIds.length
    : (await chat.listMembers({ spaceId }, options)).members.length;
  return {
    space,
    channel,
    memberCount,
    myUserId: user.id,
    messages: page.messages,
    hasOlder: page.hasOlder,
  };
}

// The page before the oldest message held.
export async function loadOlder(
  origin: string,
  token: string,
  channelId: string,
  beforeId: string,
): Promise<Page> {
  const page = await chatClient(origin, token).listMessages(
    { channelId, beforeId, limit: PAGE },
    { timeoutMs: TIMEOUT_MS },
  );
  return { messages: page.messages, hasOlder: page.hasOlder };
}

// Moves the reader's marker in the channel up to messageId.
export async function markRead(origin: string, token: string, channelId: string, messageId: string): Promise<void> {
  await chatClient(origin, token).markChannelRead({ channelId, messageId }, { timeoutMs: TIMEOUT_MS });
}
