import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { chatClient } from "../api/clients";
import { useChannelRecord } from "../api/dms";
import { hasAttention } from "../api/notifications";
import { isUnread, patchChannel, recomputeSpaceUnread } from "../api/unreads";
import { useConnectionStore } from "../stores/connection";

// While a channel is on screen and the window has attention, keep the
// server-side read marker at its newest message. Runs when the channel
// changes, when a new message lands, and when focus returns.
export function useMarkChannelRead(spaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  const { channel } = useChannelRecord(spaceId, channelId);
  const setActiveChannel = useConnectionStore((s) => s.setActiveChannel);
  const target = channel && isUnread(channel) ? channel.lastMessageId : "";

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
      chatClient
        .markChannelRead({ channelId, messageId: target })
        .then(() => {
          patchChannel(queryClient, spaceId, channelId, {
            lastReadMessageId: target,
            unreadCount: 0,
          });
          recomputeSpaceUnread(queryClient, spaceId);
        })
        .catch(() => {
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
