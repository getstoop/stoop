import type { ChannelHeader } from "@stoop/core/channelHeader";
import type { ListChangesResponse, ListMessagesResponse } from "@stoop/gen/stoop/chat/v1/chat_pb";
import { authClient, chatClient } from "./clients";

// A channel's screen: the channel and its space for the title, how many
// people can read it, who is reading (for the "New" line and what
// mentions them), and the pages and changes of its channel log
// (core/channelLog): the newest page on opening, older pages as the
// reader scrolls up, and ListChanges from the position held after a
// reconnect or a gap in the events.

const TIMEOUT_MS = 10000;
export const PAGE = 50;
// The server's largest ListChanges page.
const CHANGES_PAGE = 200;

// The channel's not being in the space's list means it was deleted, or
// the reader can no longer see it.
export class ChannelGone extends Error {}

export async function loadHeader(
  origin: string,
  token: string,
  spaceId: string,
  channelId: string,
): Promise<ChannelHeader> {
  const chat = chatClient(origin, token);
  const options = { timeoutMs: TIMEOUT_MS };
  const [{ space }, { channels }, { user }] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    authClient(origin, token).getMe({}, options),
  ]);
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!space || !user) throw new Error("The server answered with nothing.");
  if (!channel) throw new ChannelGone();
  const memberCount = channel.private
    ? (await chat.listChannelMembers({ channelId }, options)).userIds.length
    : (await chat.listMembers({ spaceId }, options)).members.length;
  return { space, channel, memberCount, myUserId: user.id };
}

// The header and the newest page together, for opening.
export async function loadChannel(
  origin: string,
  token: string,
  spaceId: string,
  channelId: string,
): Promise<{ header: ChannelHeader; page: ListMessagesResponse }> {
  const [header, page] = await Promise.all([
    loadHeader(origin, token, spaceId, channelId),
    chatClient(origin, token).listMessages({ channelId, limit: PAGE }, { timeoutMs: TIMEOUT_MS }),
  ]);
  return { header, page };
}

// The page before the oldest message held.
export function loadOlder(
  origin: string,
  token: string,
  channelId: string,
  beforeId: string,
): Promise<ListMessagesResponse> {
  return chatClient(origin, token).listMessages({ channelId, beforeId, limit: PAGE }, { timeoutMs: TIMEOUT_MS });
}

// One page of the channel's changes above a log position.
export function loadChanges(
  origin: string,
  token: string,
  channelId: string,
  sinceSeq: number,
): Promise<ListChangesResponse> {
  return chatClient(origin, token).listChanges(
    { channelId, sinceSeq: BigInt(sinceSeq), limit: CHANGES_PAGE },
    { timeoutMs: TIMEOUT_MS },
  );
}

// Moves the reader's marker in the channel up to messageId.
export async function markRead(origin: string, token: string, channelId: string, messageId: string): Promise<void> {
  await chatClient(origin, token).markChannelRead({ channelId, messageId }, { timeoutMs: TIMEOUT_MS });
}
