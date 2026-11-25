import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { type ActivityData, withActivityRead, withoutRefreshed } from "@stoop/core/activity";
import { isSystemRow } from "@stoop/core/systemMessages";
import { isOwnSend } from "@stoop/core/unreads";
import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";

// The store's rules for the older pages it holds beside the first
// (ActivityProvider). The first page's rules are core/activity.ts. Both
// rules here first drop an older entry the first page has refreshed
// (core withoutRefreshed): that row is gone on the server, and stamped
// read it would show its conversation twice.

// The older pages after a read: the same items stamped as the first page
// is (core withActivityRead), so a row past the first page leaves New
// too. first is the first page as it was before the read.
export function olderAfterRead(
  older: ActivityItem[],
  first: ActivityData,
  ids: string[] | "all",
  readAt: Timestamp,
): ActivityItem[] {
  return withActivityRead({ items: withoutRefreshed(first.items, older), unreadCount: 0 }, ids, 0, readAt).items;
}

// The older pages after the first page was loaded again: when the
// server counts no more unread than the first page shows, nothing past
// it is unread, so an older row still drawn unread (read elsewhere, by
// a marker) is stamped read.
export function olderAfterLoad(older: ActivityItem[], first: ActivityData, readAt: Timestamp): ActivityItem[] {
  const kept = withoutRefreshed(first.items, older);
  const unreadShown = first.items.filter((item) => !item.readAt).length;
  if (first.unreadCount > unreadShown || kept.every((item) => item.readAt)) return kept;
  return withActivityRead({ items: kept, unreadCount: 0 }, "all", 0, readAt).items;
}

// Whether a deleted message could take something held with it: an item
// for it, or unread items the server counts past the first page, any of
// which might be its. The server deletes a message's items with it and
// says nothing of them.
export function deletionMayClearActivity(data: ActivityData, older: ActivityItem[], messageId: string): boolean {
  if (data.items.some((item) => item.messageId === messageId)) return true;
  if (older.some((item) => item.messageId === messageId)) return true;
  return data.unreadCount > data.items.filter((item) => !item.readAt).length;
}

// The channel whose marker a new row moved for the reader, as their own
// posting moves it, or null. Sending moves the sender's marker without a
// ChannelRead; a reply only in its thread moves no channel marker, as
// web's ws.ts; nor does a quiet system message recording the reader's own
// action (a rename, a topic), which is not a send. A row that is not
// quiet (a poll, or its closing row) moves its author's marker as a send
// does (CreatePoll, ClosePoll). A reminder of theirs that the server
// delivered moves no marker (isOwnSend).
export function ownPostRead(message: Message, readerId: string | undefined): string | null {
  if (message.threadRootId && !message.inChannel) return null;
  if (isSystemRow(message) && message.quiet) return null;
  return isOwnSend(message, readerId) ? message.channelId : null;
}
