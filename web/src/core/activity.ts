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

// Unread counts grouped by space and by channel, derived from the feed so
// every badge shares one source of truth. These are notification surfaces,
// so items the server stamped muted are left out, and so are thread_reply
// items: a thread's news shows on its summary line, and the red count is
// for what is addressed to you, a mention in a thread included. The feed's
// own total (`ActivityData.unreadCount`) counts everything.
export function unreadCounts(data: ActivityData | undefined) {
  const bySpace = new Map<string, number>();
  const byChannel = new Map<string, number>();
  for (const item of data?.items ?? []) {
    if (item.readAt) continue;
    if (item.muted) continue;
    if (item.kind === ActivityKind.THREAD_REPLY) continue;
    bySpace.set(item.spaceId, (bySpace.get(item.spaceId) ?? 0) + 1);
    byChannel.set(item.channelId, (byChannel.get(item.channelId) ?? 0) + 1);
  }
  return { bySpace, byChannel };
}

// The same items as one number, for the desktop shell's dock and tray
// badge and the phone's Activity tab. Zero when nothing is loaded.
export function alertingCount(data: ActivityData | undefined): number {
  let n = 0;
  for (const count of unreadCounts(data).bySpace.values()) n += count;
  return n;
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
