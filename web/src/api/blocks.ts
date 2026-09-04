import { type QueryClient, useQuery } from "@tanstack/react-query";
import { chatClient } from "./clients";

// The people the signed-in user has blocked: no direct messages either
// way, and no mention/reply/DM alerts from them. Small and rarely
// changing, so one query shared by the card and the profile page.
export function useBlocked() {
  return useQuery({
    queryKey: ["blocked"],
    queryFn: async () => (await chatClient.listBlockedUsers({})).users,
    staleTime: 60_000,
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
  // The conversation with them is hidden while blocked.
  await queryClient.invalidateQueries({ queryKey: ["dms"] });
}
