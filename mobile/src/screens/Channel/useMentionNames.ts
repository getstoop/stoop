import { type ChannelHeader, headerMentionNames } from "@stoop/core/channelHeader";
import { type MentionNames, NO_CHANNELS, NO_GROUPS, NO_MEMBERS } from "@stoop/core/mentions";
import { canMentionEntireChannel } from "@stoop/core/permissions";
import { useMemo } from "react";

// Who and what the channel's composer may name, and whether @channel and
// @here are the reader's to use there.
export type ComposerMentions = MentionNames & { channelAndHere: boolean };

const NO_NAMES: ComposerMentions = {
  members: NO_MEMBERS,
  groups: NO_GROUPS,
  channels: NO_CHANNELS,
  channelAndHere: false,
};

// From the header the channel and thread screens share; nobody before it
// loads.
export function useMentionNames(header: ChannelHeader | null): ComposerMentions {
  return useMemo(
    () =>
      header ? { ...headerMentionNames(header), channelAndHere: canMentionEntireChannel(header.space) } : NO_NAMES,
    [header],
  );
}
