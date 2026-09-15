import type { QueryClient } from "@tanstack/react-query";

// Refetches every query whose data landed before `at`, in-flight ones
// included. Called when the gateway's Ready arrives: it is sent after the
// socket is subscribed, so anything fetched earlier may predate an event
// this socket never heard.
export function refetchOlderThan(queryClient: QueryClient, at: number) {
  return queryClient.invalidateQueries({
    predicate: (q) => q.state.dataUpdatedAt < at,
  });
}
