import { Code, ConnectError } from "@connectrpc/connect";
import type { ChannelHeader } from "@stoop/core/channelHeader";
import { dmMembers } from "@stoop/core/dms";
import { linkableChannels, NO_CHANNELS } from "@stoop/core/mentions";
import type { ListChangesResponse, ListMessagesResponse } from "@stoop/gen/stoop/chat/v1/chat_pb";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { authClient, chatClient } from "./clients";

// A channel's screen: the channel and its space for the title, how many
// people can read it, who is reading (for the "New" line and what
// mentions them), the space's channels a message's channel link opens,
// the people and groups a mention typed there may name, and the pages
// and changes of its channel log (core/channelLog): the newest page on
// opening, older pages as the reader scrolls up, and ListChanges from
// the position held after a reconnect or a gap in the events), a
// thread's replies and its root, the reader's own message, and what the
// message menu does to one. A direct message is a channel with no
// space (an empty spaceId): its header is the conversation's.

const TIMEOUT_MS = 10000;
export const PAGE = 50;
// The server's largest ListChanges page.
const CHANGES_PAGE = 200;

// The channel's not being in the space's list (or the conversation in
// the reader's) means it was deleted, or the reader can no longer see it.
export class ChannelGone extends Error {}

export async function loadHeader(
  origin: string,
  token: string,
  spaceId: string,
  channelId: string,
): Promise<ChannelHeader> {
  if (!spaceId) return loadConversationHeader(origin, token, channelId);
  const chat = chatClient(origin, token);
  const options = { timeoutMs: TIMEOUT_MS };
  const [{ space }, { channels }, { user }, { members }, { groups }] = await Promise.all([
    chat.getSpace({ spaceId }, options),
    chat.listChannels({ spaceId }, options),
    authClient(origin, token).getMe({}, options),
    chat.listMembers({ spaceId }, options),
    chat.listGroups({ spaceId }, options),
  ]);
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!space || !user) throw new Error("The server answered with nothing.");
  if (!channel) throw new ChannelGone();
  // A private channel's people are some of the space's members.
  const inChannel = channel.private
    ? new Set((await chat.listChannelMembers({ channelId }, options)).userIds)
    : null;
  return {
    space,
    channel,
    memberCount: inChannel ? inChannel.size : members.length,
    myUserId: user.id,
    channels: linkableChannels(channels),
    members: inChannel ? members.filter((member) => inChannel.has(member.userId)) : members,
    groups,
  };
}

// A conversation's header: its people, who can read it and who a mention
// may name, with no groups and no channels to link. There is no RPC for
// one conversation, so it is found in the reader's list, which holds a
// closed one too.
async function loadConversationHeader(origin: string, token: string, channelId: string): Promise<ChannelHeader> {
  const options = { timeoutMs: TIMEOUT_MS };
  const [{ directMessages }, { user }] = await Promise.all([
    chatClient(origin, token).listDirectMessages({}, options),
    authClient(origin, token).getMe({}, options),
  ]);
  if (!user) throw new Error("The server answered with nothing.");
  const dm = directMessages.find((candidate) => candidate.channel?.id === channelId);
  if (!dm?.channel) throw new ChannelGone();
  return {
    space: undefined,
    dm,
    channel: dm.channel,
    memberCount: dm.participants.length,
    myUserId: user.id,
    channels: NO_CHANNELS,
    members: dmMembers(dm),
    groups: [],
  };
}

// The header and the first page together, for opening: the newest page,
// or the page around aroundId when the screen opens at a message. A
// message the server has no row for in the channel (deleted, or a stale
// link) is no reason to call the channel gone: the newest page is loaded
// instead, and `found` says so.
export async function loadChannel(
  origin: string,
  token: string,
  spaceId: string,
  channelId: string,
  aroundId = "",
): Promise<{ header: ChannelHeader; page: ListMessagesResponse; found: boolean }> {
  let found = true;
  const firstPage = aroundId
    ? loadAround(origin, token, channelId, aroundId, PAGE).catch((err) => {
        if (!(err instanceof ConnectError && err.code === Code.NotFound)) throw err;
        found = false;
        return loadPage(origin, token, channelId);
      })
    : loadPage(origin, token, channelId);
  const [header, page] = await Promise.all([loadHeader(origin, token, spaceId, channelId), firstPage]);
  return { header, page, found };
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

// The page after the newest message held, for a range that stops short
// of the newest row.
export function loadNewer(
  origin: string,
  token: string,
  channelId: string,
  afterId: string,
): Promise<ListMessagesResponse> {
  return chatClient(origin, token).listMessages({ channelId, afterId, limit: PAGE }, { timeoutMs: TIMEOUT_MS });
}

// A thread's replies: its newest page, or the page before beforeId. The
// root is not among them.
export function loadReplies(
  origin: string,
  token: string,
  channelId: string,
  rootId: string,
  beforeId = "",
): Promise<ListMessagesResponse> {
  return chatClient(origin, token).listMessages(
    { channelId, threadId: rootId, beforeId, limit: PAGE },
    { timeoutMs: TIMEOUT_MS },
  );
}

// The channel's newest page: on opening, asked for again after a
// reconnect, or back from a range that stopped short of it.
export function loadPage(origin: string, token: string, channelId: string): Promise<ListMessagesResponse> {
  return chatClient(origin, token).listMessages({ channelId, limit: PAGE }, { timeoutMs: TIMEOUT_MS });
}

// The page around a message, which is among its rows: of one for a
// thread's root, which a thread's own pages never list; of PAGE for a
// jump to the message. A reply that shows only in its thread centres the
// page on its root, and the answer's threadRootId names the thread. The
// server answers NotFound for a message not in the channel.
export function loadAround(
  origin: string,
  token: string,
  channelId: string,
  messageId: string,
  limit = 1,
): Promise<ListMessagesResponse> {
  return chatClient(origin, token).listMessages(
    { channelId, aroundId: messageId, limit },
    { timeoutMs: TIMEOUT_MS },
  );
}

// A thread's root, for a thread opened with the channel's page not
// holding it; undefined when the server has no such message.
export async function loadRoot(
  origin: string,
  token: string,
  channelId: string,
  rootId: string,
): Promise<Message | undefined> {
  const { messages } = await loadAround(origin, token, channelId, rootId);
  return messages.find((message) => message.id === rootId);
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

// Moves the reader's marker in a thread to its newest reply.
export async function markThreadRead(origin: string, token: string, rootId: string): Promise<void> {
  await chatClient(origin, token).markThreadRead({ messageId: rootId }, { timeoutMs: TIMEOUT_MS });
}

// The reader's own mute of a thread, or its end.
export async function setThreadMuted(origin: string, token: string, rootId: string, muted: boolean): Promise<void> {
  await chatClient(origin, token).setThreadMuted({ messageId: rootId, muted }, { timeoutMs: TIMEOUT_MS });
}

// Where a message goes besides its channel: quoting another of its
// messages, into a thread, and with the thread also to the channel.
export type SendTo = {
  replyToMessageId?: string;
  threadRootId?: string;
  alsoSendToChannel?: boolean;
  // Files uploaded for it (api/files), claimed by the send.
  attachmentIds?: string[];
};

// The reader's own message. The answer is the row the server stamped,
// for the screen to merge as it merges an event's (core/channelScreen
// `sent`).
export async function sendMessage(
  origin: string,
  token: string,
  channelId: string,
  content: string,
  { replyToMessageId = "", threadRootId = "", alsoSendToChannel = false, attachmentIds = [] }: SendTo = {},
): Promise<Message> {
  const { message } = await chatClient(origin, token).sendMessage(
    {
      channelId,
      content,
      replyToMessageId,
      threadRootId,
      alsoSendToChannel: !!threadRootId && alsoSendToChannel,
      attachmentIds,
    },
    { timeoutMs: TIMEOUT_MS },
  );
  if (!message) throw new Error("The server answered with nothing.");
  return message;
}

// The reader's reaction on a message, added or taken away. The answer is
// the row with its reactions after the toggle, for the screen to merge as
// it merges a send's answer; or no row at all, which is not a failure:
// the server saves the toggle, and when its reload of the row fails it
// answers with no message and sends no event rather than report the
// save as failed (internal/chat/reactions.go), as web's toggleReaction
// takes it.
export async function toggleReaction(
  origin: string,
  token: string,
  messageId: string,
  emoji: string,
): Promise<Message | undefined> {
  const { message } = await chatClient(origin, token).toggleReaction({ messageId, emoji }, { timeoutMs: TIMEOUT_MS });
  return message;
}

// The reader's own message with new words: content only, its files
// untouched. The answer is the row at its new seq, for the screen to
// merge as it merges a send's answer (the message_updated that follows
// says the same).
export async function editMessage(origin: string, token: string, messageId: string, content: string): Promise<Message> {
  const { message } = await chatClient(origin, token).editMessage({ messageId, content }, { timeoutMs: TIMEOUT_MS });
  if (!message) throw new Error("The server answered with nothing.");
  return message;
}

// The message goes for everyone; the server decides who may (the author,
// or someone who moderates the space).
export async function deleteMessage(origin: string, token: string, messageId: string): Promise<void> {
  await chatClient(origin, token).deleteMessage({ messageId }, { timeoutMs: TIMEOUT_MS });
}

// One link's card taken off a message, for everyone, by DeleteMessage's
// rule; the server sends the message again without it.
export async function dismissLinkPreview(origin: string, token: string, messageId: string, url: string): Promise<void> {
  await chatClient(origin, token).dismissLinkPreview({ messageId, url }, { timeoutMs: TIMEOUT_MS });
}

// A message pinned to its channel, or unpinned, for everyone; the server
// decides who may (manage_channels). The message_pinned that follows
// carries the flag.
export async function setMessagePinned(origin: string, token: string, messageId: string, pinned: boolean): Promise<void> {
  await chatClient(origin, token).setMessagePinned({ messageId, pinned }, { timeoutMs: TIMEOUT_MS });
}
