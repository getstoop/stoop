import { useQuery } from "@tanstack/react-query";
import type { ListMessagesResponse } from "../gen/stoop/chat/v1/chat_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";
import { authClient, chatClient, instanceClient } from "./clients";
import { isLive, useHistoryStore } from "./history";

// Server-state hooks. Query keys are the vocabulary the WS client uses to
// apply realtime events, so keep them in sync with src/api/ws.ts.

// Public: whether the instance still needs first-run setup (no users yet).
export function useInstanceStatus() {
  return useQuery({
    queryKey: ["instance-status"],
    queryFn: async () => instanceClient.getInstanceStatus({}),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

// The configured login providers with secrets elided, for the admin
// page's Login tab. Admin-only, so gated on the tab being open.
export function useLoginProviders(enabled: boolean) {
  return useQuery({
    queryKey: ["login-providers"],
    queryFn: async () => await instanceClient.getLoginProviders({}),
    enabled,
  });
}

// The caller's linked sign-in providers (login providers), for the
// profile page's Linked accounts card.
export function useIdentities() {
  return useQuery({
    queryKey: ["identities"],
    queryFn: async () => (await authClient.listIdentities({})).identities,
  });
}

// The space behind an invite code, before the holder has an account.
// Public, so it works on the login page; a spent or unknown code errors
// rather than resolving, which is what the page shows.
export function useInvitePreview(code: string | undefined) {
  return useQuery({
    queryKey: ["invite-preview", code],
    queryFn: async () =>
      (await chatClient.lookupInvite({ code })).preview ?? null,
    enabled: !!code,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => (await authClient.getMe({})).user ?? null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSpaces() {
  return useQuery({
    queryKey: ["spaces"],
    queryFn: async () => (await chatClient.listSpaces({})).spaces,
  });
}

// Split out so a caller with several spaces in hand can ask for all of
// their channel lists at once (`useQueries`) instead of a hook per space.
export function channelsQuery(spaceId: string) {
  return {
    queryKey: ["channels", spaceId],
    queryFn: async () => (await chatClient.listChannels({ spaceId })).channels,
    enabled: spaceId !== "",
  };
}

export function useChannels(spaceId: string) {
  return useQuery(channelsQuery(spaceId));
}

// The channel's message window (see api/history.ts). `aroundId` opens the
// window centred on a message instead of the newest page — a deep link;
// if it isn't in the channel we fall back to the newest page.
export function useMessages(channelId: string, aroundId?: string) {
  return useQuery({
    queryKey: ["messages", channelId],
    queryFn: async ({ client }) => {
      // A refetch (focus, invalidation) must not yank a reader who jumped
      // into history back to the newest page; keep their window as is.
      const have = client.getQueryData<Message[]>(["messages", channelId]);
      if (have && !isLive(useHistoryStore.getState().channels[channelId])) {
        return have;
      }
      let res: ListMessagesResponse | undefined;
      if (aroundId) {
        res = await chatClient
          .listMessages({ channelId, aroundId })
          .catch(() => undefined);
      }
      res ??= await chatClient.listMessages({ channelId });
      // A real fetch resets what we know about the window's edges (edits
      // via setQueryData must not).
      useHistoryStore.getState().seed(channelId, res);
      return res.messages;
    },
    enabled: channelId !== "",
  });
}

export function useInvites(spaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["invites", spaceId],
    queryFn: async () => (await chatClient.listInvites({ spaceId })).invites,
    enabled: enabled && spaceId !== "",
  });
}

// One person's public face, for their profile card. Fetched per card so a
// renamed user shows their current name on an old message; the same query
// serves a space and a DM, which is why the card needs no fallback.
export function useUserProfile(userId: string) {
  return useQuery({
    queryKey: ["user-profile", userId],
    queryFn: async () =>
      (await authClient.getUserProfile({ userId })).profile ?? null,
    enabled: userId !== "",
    staleTime: 30_000,
  });
}

export function useMember(spaceId: string, userId: string) {
  return useQuery({
    queryKey: ["member", spaceId, userId],
    queryFn: async () =>
      (await chatClient.getMember({ spaceId, userId })).member ?? null,
    enabled: spaceId !== "" && userId !== "",
    staleTime: 30_000,
  });
}

export function useMembers(spaceId: string) {
  return useQuery({
    queryKey: ["members", spaceId],
    queryFn: async () => (await chatClient.listMembers({ spaceId })).members,
    enabled: spaceId !== "",
  });
}

// Instance admins only.
export function useInstanceUsers(enabled: boolean) {
  return useQuery({
    queryKey: ["instance-users"],
    queryFn: async () => (await instanceClient.listUsers({})).users,
    enabled,
  });
}

export function useActivity() {
  return useQuery({
    queryKey: ["activity"],
    queryFn: async () => {
      const res = await chatClient.listActivity({});
      return { items: res.items, unreadCount: res.unreadCount };
    },
  });
}

// Instance admins only: which Stoop this is. Fixed for the life of the
// process, so never refetched.
export function useBuildInfo(enabled: boolean) {
  return useQuery({
    queryKey: ["build-info"],
    queryFn: async () => instanceClient.getBuildInfo({}),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

// Instance admins only: how people reach this server.
export function useReachability(enabled: boolean) {
  return useQuery({
    queryKey: ["reachability"],
    queryFn: async () => instanceClient.getReachability({}),
    enabled,
    // Everything here is live state — the Tailscale node's progress and
    // login URL, whether LiveKit is up — so the page keeps looking while
    // it is open.
    refetchInterval: 5000,
  });
}
