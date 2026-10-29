import type { QueryClient } from "@tanstack/react-query";
import {
  type ActivityItem,
  ActivityKind,
} from "../gen/stoop/chat/v1/activity_pb";

// Cache shape for ["activity"]; kept in sync by the WS client.
export interface ActivityData {
  items: ActivityItem[];
  unreadCount: number;
}

// Adds a freshly delivered item to the cache (or refetches if the list
// hasn't been loaded yet).
export function receiveActivityItem(
  queryClient: QueryClient,
  item: ActivityItem,
) {
  const current = queryClient.getQueryData<ActivityData>(["activity"]);
  if (!current) {
    queryClient.invalidateQueries({ queryKey: ["activity"] });
    return;
  }
  // A DM's entry is refreshed in place while unread (newest preview and
  // time); anything else with a known id is a replay.
  const known = current.items.find((x) => x.id === item.id);
  if (known && item.kind !== ActivityKind.DM) return;
  const rest = current.items.filter((x) => x.id !== item.id);
  queryClient.setQueryData<ActivityData>(["activity"], {
    items: [item, ...rest],
    unreadCount:
      current.unreadCount + (item.readAt || (known && !known.readAt) ? 0 : 1),
  });
}

// Where a read marker moved: a channel, or one thread in it.
export type ReadPlace = { channelId: string } | { threadRootId: string };

// Whether a read marker that moved could have read something in the
// cached feed: an unread item in that channel or thread is in the cache,
// or the server counts unread items the cache doesn't hold (past its
// first page), any of which might be there.
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

// A read marker that moved, on this device or another, read the activity
// it passed on the server (messaging.md → Reads and unreads), so the feed
// is fetched again when it could have changed.
export function refetchActivityAfterRead(
  queryClient: QueryClient,
  place: ReadPlace,
) {
  const current = queryClient.getQueryData<ActivityData>(["activity"]);
  if (readMayClearActivity(current, place)) {
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  }
}

export function activityVerb(kind: ActivityKind): string {
  switch (kind) {
    case ActivityKind.REPLY:
      return "replied to you";
    case ActivityKind.DM:
      return "sent you a direct message";
    case ActivityKind.THREAD_REPLY:
      return "replied in a thread you're in";
    default:
      return "mentioned you";
  }
}

// Marks activity read on the server and mirrors the result into the
// cache. Shared by the activity page and the auto-read-on-view hook.
export async function markActivityRead(
  queryClient: QueryClient,
  ids: string[] | "all",
) {
  const { chatClient } = await import("./clients");
  const res = await chatClient.markActivityRead(
    ids === "all" ? { all: true } : { ids },
  );
  const readAt = nowTimestamp();
  queryClient.setQueryData<ActivityData>(["activity"], (old) =>
    old
      ? {
          unreadCount: res.unreadCount,
          items: old.items.map((item) =>
            !item.readAt && (ids === "all" || ids.includes(item.id))
              ? { ...item, readAt }
              : item,
          ),
        }
      : old,
  );
  return res.unreadCount;
}

function nowTimestamp() {
  const ms = Date.now();
  return {
    $typeName: "google.protobuf.Timestamp" as const,
    seconds: BigInt(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  };
}

// Unread counts grouped by space and by channel, derived from the cache so
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
// badge. Zero when nothing is loaded: signed out, or a fresh tab.
export function alertingCount(data: ActivityData | undefined): number {
  let n = 0;
  for (const count of unreadCounts(data).bySpace.values()) n += count;
  return n;
}
