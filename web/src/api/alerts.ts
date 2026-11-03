import type { QueryClient } from "@tanstack/react-query";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { readRow } from "./channelLog";
import { isMuted } from "./mutes";
import { refetch } from "./stale";
import { patchChannel } from "./unreads";

// The alert counts between answers (core/alerts.ts). Increments are
// local: a message addressed to the reader that lands somewhere they are
// not reading adds one to its channel and its space. Decrements refetch:
// anything that can only lower a count (a read, a deletion, a mute) asks
// for the lists again while the held count is above zero, and an unmute,
// which can raise one, always does. A direct message is never counted
// here; its alertCount is always 0.

function heldChannel(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
): Channel | undefined {
  return queryClient
    .getQueryData<Channel[]>(["channels", spaceId])
    ?.find((c) => c.id === channelId);
}

function heldSpace(
  queryClient: QueryClient,
  spaceId: string,
): Space | undefined {
  return queryClient
    .getQueryData<Space[]>(["spaces"])
    ?.find((s) => s.id === spaceId);
}

// A message addressed to the reader has landed where they are not
// reading. Nothing is added for a muted channel, space or thread, which
// the server would not count; with the channel list cold the mute is
// unknown, so the spaces list is asked for instead, as has_unread is.
export function noteAlert(
  queryClient: QueryClient,
  spaceId: string,
  channelId: string,
  threadRootId = "",
) {
  if (spaceId === "") return;
  const muted = isMuted(queryClient, spaceId, channelId);
  if (muted === undefined) {
    queryClient.invalidateQueries({ queryKey: ["spaces"] });
    return;
  }
  if (muted) return;
  if (threadRootId && readRow(channelId, threadRootId)?.thread?.muted) return;
  patchChannel(queryClient, spaceId, channelId, (c) => ({
    alertCount: c.alertCount + 1,
  }));
  queryClient.setQueryData<Space[]>(["spaces"], (old) =>
    old?.map((s) =>
      s.id === spaceId ? { ...s, alertCount: s.alertCount + 1 } : s,
    ),
  );
  // A list already out may have been read before the message was
  // written, and its answer would land over the one just added; asking
  // again means the answer is from after the event (the spaces list is
  // fetched whenever a page mounts it, so this is not rare).
  refetchIfInFlight(queryClient, ["channels", spaceId]);
  refetchIfInFlight(queryClient, ["spaces"]);
}

function refetchIfInFlight(queryClient: QueryClient, queryKey: string[]) {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (query?.state.fetchStatus === "fetching") refetch(queryClient, query);
}

// A change that can only lower a count: the channel's (a read, a
// deletion, a mute there) or, with no channel, the space's (a space
// mute, a channel gone). Both lists go again while either held count is
// above zero, since nothing can go below it.
export function refetchAlertsIfAny(
  queryClient: QueryClient,
  spaceId: string,
  channelId = "",
) {
  if (spaceId === "") return;
  const channel = channelId
    ? heldChannel(queryClient, spaceId, channelId)
    : undefined;
  const space = heldSpace(queryClient, spaceId);
  if ((channel?.alertCount ?? 0) > 0 || (space?.alertCount ?? 0) > 0) {
    refetchAlerts(queryClient, spaceId);
  }
}

// A change that can raise a count the client cannot work out (an unmute
// brings back what the mute silenced): both lists again.
export function refetchAlerts(queryClient: QueryClient, spaceId: string) {
  if (spaceId === "") return;
  queryClient.invalidateQueries({ queryKey: ["channels", spaceId] });
  queryClient.invalidateQueries({ queryKey: ["spaces"] });
}
