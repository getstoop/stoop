import { type QueryClient, useQuery } from "@tanstack/react-query";
import { chatClient } from "./clients";

// The people the signed-in user has blocked: no direct messages either
// way, and no mention/reply/DM alerts from them. Small and rarely
// changing, so one query shared by the card, the profile page and the
// app shell, which holds it from sign-in so the realtime client can tell
// a blocked author's message apart before any card has opened.
export function useBlocked(enabled = true) {
  return useQuery({
    queryKey: ["blocked"],
    queryFn: async () => (await chatClient.listBlockedUsers({})).users,
    staleTime: 60_000,
    enabled,
  });
}

export async function setBlocked(
  queryClient: QueryClient,
  userId: string,
  blocked: boolean,
) {
  if (blocked) await chatClient.blockUser({ userId });
  else await chatClient.unblockUser({ userId });
  await queryClient.invalidateQueries({ queryKey: ["blocked"] });
  // Every conversation they are in is hidden while blocked, the server
  // drops the activity that pointed at them, and the alert counts leave
  // out what they wrote (or count it again once unblocked), so every
  // list that carries a count goes again.
  await queryClient.invalidateQueries({ queryKey: ["dms"] });
  await queryClient.invalidateQueries({ queryKey: ["activity"] });
  await queryClient.invalidateQueries({ queryKey: ["spaces"] });
  await queryClient.invalidateQueries({ queryKey: ["channels"] });
}
