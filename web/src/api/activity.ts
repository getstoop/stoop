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

export function activityVerb(kind: ActivityKind): string {
  switch (kind) {
    case ActivityKind.REPLY:
      return "replied to you";
    case ActivityKind.DM:
      return "messaged you";
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
// so items the server stamped muted are left out; the feed's own total
// (`ActivityData.unreadCount`) counts everything.
export function unreadCounts(data: ActivityData | undefined) {
  const bySpace = new Map<string, number>();
  const byChannel = new Map<string, number>();
  for (const item of data?.items ?? []) {
    if (item.readAt) continue;
    if (item.muted) continue;
    bySpace.set(item.spaceId, (bySpace.get(item.spaceId) ?? 0) + 1);
    byChannel.set(item.channelId, (byChannel.get(item.channelId) ?? 0) + 1);
  }
  return { bySpace, byChannel };
}
