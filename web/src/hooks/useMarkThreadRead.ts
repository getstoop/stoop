import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { hasAttention } from "../api/notifications";
import { markThreadRead } from "../api/threads";

// An open thread with new replies is read once the window has the user's
// attention, as useAutoReadActivity reads a channel's activity.
export function useMarkThreadRead(
  channelId: string,
  rootId: string,
  unreadCount: number,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (unreadCount === 0 || !rootId) return;
    let done = false;
    const run = () => {
      if (done || !hasAttention()) return;
      done = true;
      markThreadRead(queryClient, channelId, rootId).catch(() => {
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
  }, [unreadCount, channelId, rootId, queryClient]);
}
