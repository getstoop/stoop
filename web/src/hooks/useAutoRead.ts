import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { markActivityRead } from "../api/activity";
import { hasAttention } from "../api/notifications";
import { useActivity } from "../api/queries";

// Seeing the channel is reading the activity: while this channel is
// open and the window has the user's attention (visible and focused),
// unread activity items that point here are marked read — however the
// user got here, including ones that arrive while they're already here.
// An unfocused or hidden window doesn't count as seen, so desktop alerts
// still fire for it.
export function useAutoReadActivity(channelId: string) {
  const queryClient = useQueryClient();
  const { data } = useActivity();
  const unreadIds = (data?.items ?? [])
    .filter((item) => !item.readAt && item.channelId === channelId)
    .map((item) => item.id);
  const key = unreadIds.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: key encodes unreadIds
  useEffect(() => {
    if (!key) return;
    let done = false;
    const run = () => {
      if (done || !hasAttention()) return;
      done = true;
      markActivityRead(queryClient, unreadIds).catch(() => {
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
  }, [key, channelId, queryClient]);
}
