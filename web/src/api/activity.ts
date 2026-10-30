import type { QueryClient } from "@tanstack/react-query";
import {
  type ActivityData,
  type ReadPlace,
  readMayClearActivity,
  withActivityItem,
  withActivityRead,
} from "../core/activity";
import type { ActivityItem } from "../gen/stoop/chat/v1/activity_pb";

// The ["activity"] query cache, kept in sync by the WS client. The
// feed's rules live in core/activity.ts, shared with the phone; this
// file applies them to the cache.

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
  const next = withActivityItem(current, item);
  if (next !== current) {
    queryClient.setQueryData<ActivityData>(["activity"], next);
  }
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
    old ? withActivityRead(old, ids, res.unreadCount, readAt) : old,
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
