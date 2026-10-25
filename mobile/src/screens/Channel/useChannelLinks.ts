import type { ChannelHeader } from "@stoop/core/channelHeader";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import type { ChannelLinks } from "../../components/MessageBody/channelLinks";
import type { SavedServer } from "../../servers";

// What a channel link in a message opens, for the channel and thread
// screens' MessageBody: the space's channels the header was fetched with,
// each pushed as its channel screen. A link to the channel shown opens
// nothing; from its thread, it goes back to the channel.
export function useChannelLinks(
  server: SavedServer,
  spaceId: string,
  channelId: string,
  header: ChannelHeader | null,
  inThread = false,
): ChannelLinks | null {
  const router = useRouter();
  const channels = header?.channels;
  return useMemo(() => {
    if (!channels) return null;
    const open = (channel: Channel) => {
      const href = {
        pathname: "/s/[id]/space/[spaceId]/channel/[channelId]",
        params: { id: server.id, spaceId, channelId: channel.id },
      } as const;
      if (channel.id !== channelId) router.push(href);
      else if (inThread) router.dismissTo(href);
    };
    return { channels, open };
  }, [channels, router, server.id, spaceId, channelId, inThread]);
}
