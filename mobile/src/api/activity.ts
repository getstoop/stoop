import type { ActivityData } from "@stoop/core/activity";
import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { authClient, chatClient } from "./clients";

// The Activity tab and its badge (src/activity): the first page of the
// feed with the server's unread count, older pages as the list is
// scrolled, reading items, who is reading (whose handle a preview
// lights, and whose own message moves a read marker), and the names of
// the spaces and channels the rows point at, which an item carries only
// as IDs. The feed's rules are core/activity.ts, shared with web.

const TIMEOUT_MS = 10000;

export type Reader = { id: string; username: string };

export async function loadActivity(origin: string, token: string): Promise<ActivityData> {
  const { items, unreadCount } = await chatClient(origin, token).listActivity({}, { timeoutMs: TIMEOUT_MS });
  return { items, unreadCount };
}

// The page of items older than beforeId; empty past the oldest.
export async function loadOlderActivity(origin: string, token: string, beforeId: string): Promise<ActivityItem[]> {
  const { items } = await chatClient(origin, token).listActivity({ beforeId }, { timeoutMs: TIMEOUT_MS });
  return items;
}

// Reads the given items, or all of them. Says the server's new count.
export async function readActivity(origin: string, token: string, ids: string[] | "all"): Promise<number> {
  const { unreadCount } = await chatClient(origin, token).markActivityRead(ids === "all" ? { all: true } : { ids }, {
    timeoutMs: TIMEOUT_MS,
  });
  return unreadCount;
}

export async function loadReader(origin: string, token: string): Promise<Reader> {
  const { user } = await authClient(origin, token).getMe({}, { timeoutMs: TIMEOUT_MS });
  if (!user) throw new Error("The server answered with nothing.");
  return { id: user.id, username: user.username };
}

// The spaces this account is in, for a row's space name.
export async function loadSpaceList(origin: string, token: string): Promise<Space[]> {
  const { spaces } = await chatClient(origin, token).listSpaces({}, { timeoutMs: TIMEOUT_MS });
  return spaces;
}

// A space's channels, for a row's channel name.
export async function loadChannelList(origin: string, token: string, spaceId: string): Promise<Channel[]> {
  const { channels } = await chatClient(origin, token).listChannels({ spaceId }, { timeoutMs: TIMEOUT_MS });
  return channels;
}

// Reads the reader's unread activity in a channel itself (mentions and
// replies there, not in its threads), as web's useAutoReadActivity: the
// channel's mention badge counts these, not the marker. Asks the server
// rather than trusting the feed held, which may be behind. Says which it
// read and the server's count after.
export async function readChannelActivity(
  origin: string,
  token: string,
  channelId: string,
): Promise<{ ids: string[]; unreadCount: number }> {
  const chat = chatClient(origin, token);
  const { items, unreadCount } = await chat.listActivity({}, { timeoutMs: TIMEOUT_MS });
  const ids = items
    .filter((item) => !item.readAt && item.channelId === channelId && !item.threadRootId)
    .map((item) => item.id);
  if (ids.length === 0) return { ids, unreadCount };
  const after = await chat.markActivityRead({ ids }, { timeoutMs: TIMEOUT_MS });
  return { ids, unreadCount: after.unreadCount };
}
