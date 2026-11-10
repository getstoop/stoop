import type { NotificationData } from "./content";
import type { FocusedPlace } from "./focus";

// Which notifications a read takes out of the system's list: one stays
// only while what it points at is unread. Always one server's: a
// channel's read (its screen in front, or its marker moved, here or on
// another device) clears what landed in the channel itself and leaves
// its threads' replies, which only the thread's read clears; marking
// activity read clears those items, or all of them; and everything goes
// when the server is forgotten or its session ends. A thread's reply
// also sent to its channel counts as the thread's alone: the data
// doesn't say it is in the channel too.

export type Read = { serverId: string } & (
  | { all: true }
  | { itemIds: string[] }
  | { channelId: string }
  | { threadRootId: string }
);

export function clears(read: Read, data: NotificationData): boolean {
  if (data.serverId !== read.serverId) return false;
  if ("all" in read) return true;
  if ("itemIds" in read) return read.itemIds.includes(data.itemId);
  if ("threadRootId" in read) return data.threadRootId === read.threadRootId;
  return !data.threadRootId && data.channelId === read.channelId;
}

// What having a place on screen reads: the thread on a thread's screen,
// the channel on a channel's.
export function readOfPlace({ serverId, channelId, threadRootId }: FocusedPlace): Read {
  return threadRootId ? { serverId, threadRootId } : { serverId, channelId };
}
