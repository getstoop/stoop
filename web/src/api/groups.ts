import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import { chatClient } from "./clients";
import { type MentionGroups, mentionGroups, NO_GROUPS } from "./mentions";
import { channelsQuery } from "./queries";

// A space's groups, each mentioned all at once as @handle in its public
// channels (docs/architecture/messaging.md → Groups).
export const groupsKey = (spaceId: string) => ["groups", spaceId];

export const GROUP_HANDLE_HINT =
  "What people type after @. Letters, numbers and _.";
export const MAX_GROUP_NAME = 50;

export function useGroups(spaceId: string) {
  return useQuery({
    queryKey: groupsKey(spaceId),
    queryFn: async () => (await chatClient.listGroups({ spaceId })).groups,
    enabled: spaceId !== "",
  });
}

// The groups a mention reaches in a channel: a space's public channels
// only. In a private channel or a DM there are none, as for the server.
export function useChannelGroups(
  spaceId: string,
  channelId: string,
): MentionGroups {
  // Read the list the channel view already holds: a refetch on every
  // mount (the timeline remounts per channel) would put a stale read
  // marker back over the one opening the channel just advanced.
  const { data: channels } = useQuery({
    ...channelsQuery(spaceId),
    refetchOnMount: false,
  });
  const { data: groups } = useGroups(spaceId);
  const channel = channels?.find((candidate) => candidate.id === channelId);
  const usable = !!channel && !channel.private;
  return useMemo(
    () => (usable ? mentionGroups(groups) : NO_GROUPS),
    [usable, groups],
  );
}

export type GroupFields = { handle: string; name: string; userIds: string[] };

// A new group when existing is absent, else that group's new fields.
export async function saveGroup(
  queryClient: QueryClient,
  spaceId: string,
  fields: GroupFields,
  existing?: Group,
) {
  if (existing) {
    await chatClient.updateGroup({ groupId: existing.id, ...fields });
  } else {
    await chatClient.createGroup({ spaceId, ...fields });
  }
  await queryClient.invalidateQueries({ queryKey: groupsKey(spaceId) });
}

export async function deleteGroup(queryClient: QueryClient, group: Group) {
  await chatClient.deleteGroup({ groupId: group.id });
  await queryClient.invalidateQueries({ queryKey: groupsKey(group.spaceId) });
}

// "Garden crew (3)" is how a group is named in a list.
export const groupCount = (group: Group) => `(${group.userIds.length})`;
