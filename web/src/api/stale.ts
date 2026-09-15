import type { Query, QueryClient } from "@tanstack/react-query";

// Refetches one query. A first load still in flight is left to finish and
// then fetched again: TanStack dedupes a refetch onto a load that has no
// data yet rather than restarting it, and that load may have read the
// server before whatever prompted this.
export function refetch(queryClient: QueryClient, query: Query) {
  const again = () =>
    queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
  if (
    query.state.fetchStatus === "fetching" &&
    query.state.data === undefined
  ) {
    return query
      .fetch()
      .catch(() => {})
      .then(again);
  }
  return again();
}

// Refetches every query whose data landed before `at`, in-flight ones
// included. Called when the gateway's Ready arrives: it is sent after the
// socket is subscribed, so anything fetched earlier may predate an event
// this socket never heard.
export function refetchOlderThan(queryClient: QueryClient, at: number) {
  return Promise.all(
    queryClient
      .getQueryCache()
      .findAll({ predicate: (q) => q.state.dataUpdatedAt < at })
      .map((q) => refetch(queryClient, q)),
  );
}
