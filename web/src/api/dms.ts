import { create } from "@bufbuild/protobuf";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { DirectMessage } from "../gen/stoop/chat/v1/chat_pb";
import { type Member, MemberSchema } from "../gen/stoop/chat/v1/member_pb";
import type { MessageAuthor } from "../gen/stoop/chat/v1/message_pb";
import { SpaceRole } from "../gen/stoop/chat/v1/space_pb";
import { chatClient } from "./clients";
import { useChannels, useMembers } from "./queries";

// Direct messages are channels with no space. The channel view, unread
// bookkeeping and realtime handling all key on `spaceId === ""` to reach
// the ["dms"] cache instead of a space's ["channels", id] list; the
// helpers here are that seam.

export function useDirectMessages(enabled = true) {
  return useQuery({
    queryKey: ["dms"],
    queryFn: async () =>
      (await chatClient.listDirectMessages({})).directMessages,
    enabled,
  });
}

// The channel record for a view, from whichever list holds it. `loaded`
// says the list has arrived, so a missing channel means "gone".
export function useChannelRecord(
  spaceId: string,
  channelId: string,
): { channel: Channel | undefined; loaded: boolean } {
  const channels = useChannels(spaceId);
  const dms = useDirectMessages(spaceId === "");
  if (spaceId) {
    return {
      channel: channels.data?.find((c) => c.id === channelId),
      loaded: !!channels.data,
    };
  }
  return {
    channel: dms.data?.find((d) => d.channel?.id === channelId)?.channel,
    loaded: !!dms.data,
  };
}

// The people who can be mentioned, shown typing, or looked up by name in a
// conversation: the space's members, or a DM's participants dressed as
// members (no role, no join date).
export function usePeople(
  spaceId: string,
  channelId: string,
): Member[] | undefined {
  const members = useMembers(spaceId);
  const dms = useDirectMessages(spaceId === "");
  const dm = spaceId
    ? undefined
    : dms.data?.find((d) => d.channel?.id === channelId);
  // The same array until the conversation's record changes.
  const participants = useMemo(
    () => dm?.participants.map(participantAsMember),
    [dm],
  );
  return spaceId ? members.data : participants;
}

function participantAsMember(p: MessageAuthor): Member {
  return create(MemberSchema, {
    userId: p.id,
    username: p.username,
    displayName: p.displayName,
    avatarFileId: p.avatarFileId,
    role: SpaceRole.MEMBER,
  });
}

// Opens the conversation with these people, creating it if it does not
// exist — a conversation is its participants, so there is only ever one
// with a given set. Returns its channel id.
export async function openDirectMessage(
  queryClient: QueryClient,
  userIds: string[],
): Promise<string> {
  const res = await chatClient.openDirectMessage({ userIds });
  const id = res.directMessage?.channel?.id ?? "";
  await queryClient.invalidateQueries({ queryKey: ["dms"] });
  return id;
}

// The people the caller can start a conversation with. Fetched when a
// picker opens, not held: it is a list of names and it goes stale.
export function useDMCandidates(enabled = true) {
  return useQuery({
    queryKey: ["dm-candidates"],
    queryFn: async () =>
      (await chatClient.listDirectMessageCandidates({})).users,
    enabled,
    gcTime: 0,
  });
}

// Patches one DM's channel in the cache and keeps the list in activity
// order (newest message first), the order the server lists them in.
export function patchDirectMessage(
  queryClient: QueryClient,
  channelId: string,
  patch: (c: Channel) => Partial<Channel>,
) {
  queryClient.setQueryData<DirectMessage[]>(["dms"], (old) =>
    old
      ?.map((d) =>
        d.channel?.id === channelId
          ? { ...d, channel: { ...d.channel, ...patch(d.channel) } }
          : d,
      )
      .sort((a, b) =>
        (b.channel?.lastMessageId ?? "").localeCompare(
          a.channel?.lastMessageId ?? "",
        ),
      ),
  );
}
