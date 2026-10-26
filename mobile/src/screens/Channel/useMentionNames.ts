import { type ChannelHeader, headerMentionNames } from "@stoop/core/channelHeader";
import { type MentionNames, NO_CHANNELS, NO_GROUPS, NO_MEMBERS } from "@stoop/core/mentions";
import { useMemo } from "react";

const NO_NAMES: MentionNames = { members: NO_MEMBERS, groups: NO_GROUPS, channels: NO_CHANNELS };

// Who and what a handle typed in the channel's composer names, from the
// header the channel and thread screens share; nobody before it loads.
export function useMentionNames(header: ChannelHeader | null): MentionNames {
  return useMemo(() => (header ? headerMentionNames(header) : NO_NAMES), [header]);
}
