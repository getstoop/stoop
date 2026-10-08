import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { hasAttention } from "../api/notifications";
import { markThreadRead } from "../api/threads";
import type { ThreadSummary } from "../gen/stoop/chat/v1/message_pb";

// An open thread is read once the window has the user's attention, as
// useAutoReadActivity reads a channel's activity: again for each new
// reply, and muted or not, so unmuting later doesn't bring back replies
// already seen. summary is undefined until the replies are on screen.
export function useMarkThreadRead(
  channelId: string,
  rootId: string,
  summary: ThreadSummary | undefined,
) {
  const queryClient = useQueryClient();
  const key = summary ? `${summary.replyCount}:${summary.unreadCount}` : "";
  useEffect(() => {
    if (!key || !rootId) return;
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
  }, [key, channelId, rootId, queryClient]);
}
