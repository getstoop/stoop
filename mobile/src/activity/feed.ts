import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { type ActivityData, withActivityRead } from "@stoop/core/activity";
import type { ActivityItem } from "@stoop/gen/stoop/chat/v1/activity_pb";

// The store's rules for the older pages it holds beside the first
// (ActivityProvider). The first page's rules are core/activity.ts.

// The older pages after a read: the same items stamped as the first page
// is (core withActivityRead), so a row past the first page leaves New too.
export function olderAfterRead(older: ActivityItem[], ids: string[] | "all", readAt: Timestamp): ActivityItem[] {
  return withActivityRead({ items: older, unreadCount: 0 }, ids, 0, readAt).items;
}

// The older pages after the first page was loaded again: when the
// server counts no more unread than the first page shows, nothing past
// it is unread, so an older row still drawn unread (read elsewhere, by
// a marker) is stamped read.
export function olderAfterLoad(older: ActivityItem[], first: ActivityData, readAt: Timestamp): ActivityItem[] {
  const unreadShown = first.items.filter((item) => !item.readAt).length;
  if (first.unreadCount > unreadShown || older.every((item) => item.readAt)) return older;
  return olderAfterRead(older, "all", readAt);
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
