import type { Page } from "@stoop/core/channelTimeline";
import type { ChannelHeader } from "@stoop/core/timelineEvents";
import { authClient, chatClient } from "./clients";

// A channel's screen: the channel and its space for the title, how many
// people can read it, who is reading (for the "New" line and what
// mentions them), and the newest page of its messages. Older pages load
// as the reader scrolls up; realtime events keep what is held current
// (core/timelineState, core/timelineEvents).

const TIMEOUT_MS = 10000;
const PAGE = 50;

// The channel's not being in the space's list means it was deleted, or
// the reader can no longer see it.
export class ChannelGone extends Error {}

// With back, the id of the oldest message held, the history down to it
// too: after a reconnect, as on web, everything held is fetched again,
// since an older message may have been edited or deleted meanwhile.
export async function loadChannel(
  origin: string,
  token: string,
  spaceId: string,
  channelId: string,
  back = "",
): Promise<{ header: ChannelHeader; page: Page }> {
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
  let messages = page.messages;
  let hasOlder = page.hasOlder;
  while (back && hasOlder && messages[0] && messages[0].id > back) {
    const older = await chat.listMessages({ channelId, beforeId: messages[0].id, limit: PAGE }, options);
    if (older.messages.length === 0) break;
    messages = [...older.messages, ...messages];
    hasOlder = older.hasOlder;
  }
  return { header: { space, channel, memberCount, myUserId: user.id }, page: { messages, hasOlder } };
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
