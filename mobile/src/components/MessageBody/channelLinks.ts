import type { MentionChannels } from "@stoop/core/mentions";
import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { createContext } from "react";

// The channels a message's channel link opens (the space's public text
// channels, linkableChannels) and how to open one, from the screen showing
// the messages. Without it, or for a channel not among them, a channel
// link is a pill that opens nothing.
export type ChannelLinks = {
  channels: MentionChannels;
  open: (channel: Channel) => void;
};

export const ChannelLinksContext = createContext<ChannelLinks | null>(null);
