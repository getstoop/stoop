import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { Group } from "../gen/stoop/chat/v1/group_pb";
import { chatClient } from "./clients";

// A space's groups, each mentioned all at once as @@handle in its public
// channels (docs/architecture/messaging.md → Groups).
export const groupsKey = (spaceId: string) => ["groups", spaceId];

export const GROUP_HANDLE_HINT =
  "What people type after @@. Letters, numbers and _.";
export const MAX_GROUP_NAME = 50;

export function useGroups(spaceId: string) {
  return useQuery({
    queryKey: groupsKey(spaceId),
    queryFn: async () => (await chatClient.listGroups({ spaceId })).groups,
    enabled: spaceId !== "",
  });
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
