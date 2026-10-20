import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  linkableChannels,
  type MentionChannels,
  NO_CHANNELS,
} from "../core/mentions";
import { channelsQuery } from "./queries";

// The channels a #link names in a channel: the space's public text
// channels, from its public channels only. In a private channel or a DM
// there are none, as for the server (docs/architecture/messaging.md →
// Channel links).
export function useLinkableChannels(
  spaceId: string,
  channelId: string,
): MentionChannels {
  // The list the channel view already holds, as useChannelGroups reads it.
  const { data: channels } = useQuery({
    ...channelsQuery(spaceId),
    refetchOnMount: false,
  });
  const channel = channels?.find((candidate) => candidate.id === channelId);
  const usable = !!channel && !channel.private;
  return useMemo(
    () => (usable ? linkableChannels(channels) : NO_CHANNELS),
    [usable, channels],
  );
}
