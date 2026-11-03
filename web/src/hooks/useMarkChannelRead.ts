import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useChannelRecord } from "../api/dms";
import { hasAttention } from "../api/notifications";
import { markChannelRead, readOnArrivalTarget } from "../api/unreads";
import { isUnread } from "../core/unreads";
import { useConnectionStore } from "../stores/connection";

// While a channel is on screen and the window has attention, keep the
// server-side read marker at its newest message. Runs when the channel
// changes, when a new message lands, and when focus returns. A message
// that lands while the channel has attention is shown read as it arrives
// (api/ws.ts), and the server hears of it from here, the one place that
// speaks for the channel on screen: the record it left is read during
// the same render as the cache patch that re-ran this.
export function useMarkChannelRead(spaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  const { channel } = useChannelRecord(spaceId, channelId);
  const setActiveChannel = useConnectionStore((s) => s.setActiveChannel);
  const target = !channel
    ? ""
    : isUnread(channel)
      ? channel.lastMessageId
      : readOnArrivalTarget(channel);

  useEffect(() => {
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  useEffect(() => {
    if (!target) return;
    let done = false;
    const run = () => {
      if (done || !hasAttention()) return;
      done = true;
      markChannelRead(queryClient, spaceId, channelId, target).catch(() => {
        done = false;
      });
    };
    run();
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [target, channelId, spaceId, queryClient]);
}
