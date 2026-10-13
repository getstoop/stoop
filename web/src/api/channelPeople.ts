import { type QueryClient, useQuery } from "@tanstack/react-query";
import { chatClient } from "./clients";

// Who is in a private channel, as user ids in the order they were added;
// the space's member list has the rest about each person.
export const channelPeopleKey = (channelId: string) => [
  "channel-people",
  channelId,
];

export function useChannelPeople(channelId: string, enabled = true) {
  return useQuery({
    queryKey: channelPeopleKey(channelId),
    queryFn: async () =>
      (await chatClient.listChannelMembers({ channelId })).userIds,
    enabled: enabled && channelId !== "",
  });
}

export async function addChannelPeople(
  queryClient: QueryClient,
  channelId: string,
  userIds: string[],
) {
  await chatClient.addChannelMembers({ channelId, userIds });
  await queryClient.invalidateQueries({
    queryKey: channelPeopleKey(channelId),
  });
}

export async function removeChannelPerson(
  queryClient: QueryClient,
  channelId: string,
  userId: string,
) {
  await chatClient.removeChannelMember({ channelId, userId });
  await queryClient.invalidateQueries({
    queryKey: channelPeopleKey(channelId),
  });
}

// Every channel in a space as Space settings lists them, for someone who
// manages channels: the private ones they are not in too, with how many
// people each holds.
export const allChannelsKey = (spaceId: string) => ["all-channels", spaceId];

export function useAllChannels(spaceId: string, enabled = true) {
  return useQuery({
    queryKey: allChannelsKey(spaceId),
    queryFn: async () =>
      (await chatClient.listAllChannels({ spaceId })).channels,
    enabled: enabled && spaceId !== "",
  });
}
