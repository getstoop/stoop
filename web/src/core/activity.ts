import { type Timestamp, timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type ActivityItem,
  ActivityKind,
} from "../gen/stoop/chat/v1/activity_pb";
import { sameDay, shortDateTime } from "./dates";

// The activity feed as a client holds it: the first page of
// ListActivity, kept current from ActivityItemCreated, and the server's
// count of everything unread (which can reach past the page). Web keeps
// it in its query cache (api/activity.ts); the phone in its own store.
// No badge is counted from it: those read the server's alert counts
// (core/alerts.ts).
export interface ActivityData {
  items: ActivityItem[];
  unreadCount: number;
}

// The feed with a freshly delivered item on top. A DM's entry is
// refreshed in place while unread (newest preview and time); anything
// else with a known id is a replay, and the feed comes back unchanged.
export function withActivityItem(
  data: ActivityData,
  item: ActivityItem,
): ActivityData {
  const known = data.items.find((x) => x.id === item.id);
  if (known && item.kind !== ActivityKind.DM) return data;
  const rest = data.items.filter((x) => x.id !== item.id);
  return {
    items: [item, ...rest],
    unreadCount:
      data.unreadCount + (item.readAt || (known && !known.readAt) ? 0 : 1),
  };
}

// The feed after MarkActivityRead answered: the given items (or all of
// them) stamped read at readAt, and the server's new count.
export function withActivityRead(
  data: ActivityData,
  ids: string[] | "all",
  unreadCount: number,
  readAt: Timestamp,
): ActivityData {
  return {
    unreadCount,
    items: data.items.map((item) =>
      !item.readAt && (ids === "all" || ids.includes(item.id))
        ? { ...item, readAt }
        : item,
    ),
  };
}

// Where a read marker moved: a channel, or one thread in it.
export type ReadPlace = { channelId: string } | { threadRootId: string };

// Whether a read marker that moved could have read something in the
// held feed: an unread item in that channel or thread is in it, or the
// server counts unread items the feed doesn't hold (past its first
// page), any of which might be there. Reading on the server reads the
// activity the marker passed (messaging.md → Reads and unreads), so a
// client fetches the feed again when this says it could have changed.
export function readMayClearActivity(
  data: ActivityData | undefined,
  place: ReadPlace,
): boolean {
  if (!data) return false;
  const unread = data.items.filter((item) => !item.readAt);
  if (data.unreadCount > unread.length) return true;
  return unread.some((item) =>
    "channelId" in place
      ? item.channelId === place.channelId
      : item.threadRootId === place.threadRootId,
  );
}

// Whether a deleted message could take something in the held feed with
// it: an item for that message or, for a thread's root (Delete thread
// takes its replies, with one event for the root), for a reply in it; or
// unread items the server counts past the first page, any of which might
// be its. The server deletes a message's activity with it and sends no
// event for that, so a client fetches the feed again when this says it
// could have changed.
export function deletionMayClearActivity(
  data: ActivityData | undefined,
  messageId: string,
): boolean {
  if (!data) return false;
  const held = data.items.some(
    (item) => item.messageId === messageId || item.threadRootId === messageId,
  );
  if (held) return true;
  return data.unreadCount > data.items.filter((item) => !item.readAt).length;
}

// The whole inbox as shown: the held first page, then the older pages
// loaded as the list was scrolled, less what the first page holds too
// (it moves on as items arrive, so an older page can overlap it).
export function withOlderPages(
  recent: ActivityItem[],
  older: ActivityItem[],
): ActivityItem[] {
  const held = new Set(recent.map((item) => item.id));
  return [...recent, ...older.filter((item) => !held.has(item.id))];
}

// Whether an item in the Read section opens a day, the one above it
// (newest first) being from another day or the first. An item with no
// time opens one, so a label is never wrongly left off.
export function startsDay(
  item: ActivityItem,
  prev: ActivityItem | undefined,
): boolean {
  return (
    !prev?.createdAt ||
    !item.createdAt ||
    !sameDay(timestampDate(prev.createdAt), timestampDate(item.createdAt))
  );
}

export function activityVerb(kind: ActivityKind): string {
  switch (kind) {
    case ActivityKind.REPLY:
      return "replied to you";
    case ActivityKind.DM:
      return "sent you a direct message";
    case ActivityKind.THREAD_REPLY:
      return "replied in a thread";
    default:
      return "mentioned you";
  }
}

// A row's time. A recent row says how long ago. Past a day, a dated row
// carries the date (nothing above it does: the New section); an undated
// row sits under a day label, so it only needs the time of day.
export function activityTime(
  d: Date,
  dated: boolean,
  now: Date = new Date(),
): string {
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (dated) return shortDateTime(d, now);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------
// Filling New. The inbox loads the newest page of the feed whatever the
// state of its items, so an unread item older than that page is not on
// it until the person scrolls that far, while the header counts it.
// While the server counts more unread than the items held show, the
// next older page is asked for without a scroll, up to NEW_AUTO_PAGES
// of them (500 items at the default page size); past that the person
// scrolls as before, so a feed with thousands of read items between
// unread ones cannot page forever. The count can also exceed what is
// held when an item held was read on another device and the feed has
// not been fetched again; the bound, or the oldest page coming back
// empty, ends that too, and the next fetch of the first page puts the
// count right.

export const NEW_AUTO_PAGES = 10;

// Whether the inbox should fetch the next older page on its own for
// New's sake: the server counts more unread than the items held (first
// page and older pages) show, the oldest page did not come back empty,
// and fewer than NEW_AUTO_PAGES have been fetched this way. Nothing held
// means no page to ask before.
export function needsOlderPageForNew(
  unreadCount: number,
  held: ActivityItem[],
  exhausted: boolean,
  autoPages: number,
): boolean {
  if (exhausted || autoPages >= NEW_AUTO_PAGES || held.length === 0) {
    return false;
  }
  return unreadCount > held.filter((item) => !item.readAt).length;
}
