import type { QueryClient } from "@tanstack/react-query";
import {
  type Channel,
  ChannelKind,
  ChannelPostPolicy,
} from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { announce } from "../stores/announcer";
import { confirm, notice, prompt } from "../stores/dialogs";
import { chatClient } from "./clients";
import { errorText } from "./errors";
import { patchChannel, recomputeSpaceUnread } from "./unreads";

// A space's channels in sidebar order, as the server lists them: by
// position, then oldest first.
export function byPosition(channels: Channel[]): Channel[] {
  return [...channels].sort(
    (a, b) =>
      a.position - b.position ||
      Number((a.createdAt?.seconds ?? 0n) - (b.createdAt?.seconds ?? 0n)) ||
      // nanos is the fraction of the second, not a whole timestamp.
      (a.createdAt?.nanos ?? 0) - (b.createdAt?.nanos ?? 0),
  );
}

// A reorder as the space is told of it: each channel named takes its new
// position, and the list is put back in order. A private channel is not
// named there; its position arrives on its own, for the people in it.
export function withPositions(
  channels: Channel[],
  moved: { id: string; position: number }[],
): Channel[] {
  const positions = new Map(moved.map((c) => [c.id, c.position]));
  return byPosition(
    channels.map((c) =>
      positions.has(c.id) ? { ...c, position: positions.get(c.id) ?? 0 } : c,
    ),
  );
}

// The channels a space may point new arrivals at. Voice is excluded here
// and again on the server: landing someone in a voice channel would open
// a microphone they never asked to open. So is a private channel, which
// an arrival can't see.
export function defaultChannelChoices(channels: Channel[]): Channel[] {
  return channels.filter((c) => c.kind === ChannelKind.TEXT && !c.private);
}

// Which channel to open for someone who hasn't picked one — an invite, or
// /s/{id} with nothing after it. The space's default when it still
// exists, otherwise whichever channel sorts first, which is what every
// space did before there was a default.
//
// Presence in the list is what decides, never the id on its own. Deleting
// the chosen channel clears the column, but a client that was offline for
// that event still holds the old id, and following it would land someone
// on a channel that isn't there.
export function landingChannel(
  space: Space | undefined,
  channels: Channel[] | undefined,
): Channel | undefined {
  if (!channels?.length) return undefined;
  const chosen = space?.defaultChannelId
    ? channels.find((c) => c.id === space.defaultChannelId)
    : undefined;
  // Text first for the same reason defaultChannelChoices excludes voice:
  // whichever channel sorts first may be a voice one, and arriving in a
  // voice channel joins the room. A space with nothing but voice channels
  // still lands there — saying "No channels yet" to someone looking at a
  // list of channels would be worse.
  return (
    chosen ?? channels.find((c) => c.kind === ChannelKind.TEXT) ?? channels[0]
  );
}

// The server's own limit, mirrored so the field counts down rather than
// let a save fail (internal/chat/channels.go).
export const MAX_CHANNEL_TOPIC = 250;
// Mirrors validChannelName on the server, which has the last word.
export const MAX_CHANNEL_NAME = 32;
export const CHANNEL_NAME_HINT = `Lowercase a-z, numbers, - and _. Starts with a letter or number. ${MAX_CHANNEL_NAME} characters at most.`;

// Ask for a channel's topic and save it. Shared by the three places that
// offer the edit — the header, the channel's ⋮ and space settings — so
// they can't drift apart. Clearing the field removes the topic, which is
// why an empty answer is a real answer here and only null means cancel.
export async function editChannelTopic(
  channel: Channel,
  queryClient: QueryClient,
): Promise<void> {
  await prompt({
    title: `Topic for #${channel.name}`,
    body: "One line, shown in the channel header. Plain text.",
    label: "Topic",
    initial: channel.topic,
    placeholder: "Borrow anything on the shelf — sign it out here.",
    action: "Save",
    multiline: true,
    maxLength: MAX_CHANNEL_TOPIC,
    allowEmpty: true,
    submit: async (topic) => {
      if (topic === channel.topic) return;
      await chatClient.updateChannel({ channelId: channel.id, topic });
      await queryClient.invalidateQueries({
        queryKey: ["channels", channel.spaceId],
      });
    },
  });
}

// Only admins, the owner and bots post in an announcement channel.
export const isAnnouncement = (channel: Channel | undefined) =>
  channel?.postPolicy === ChannelPostPolicy.ADMINS;

// Make a channel an announcement channel or let everyone post again.
// Shared by the channel's ⋮ and space settings; only the ⋮ asks first
// (ask), since turning it on stops people mid-conversation.
export async function setAnnouncement(
  channel: Channel,
  on: boolean,
  queryClient: QueryClient,
  ask = false,
): Promise<void> {
  if (on && ask) {
    const ok = await confirm({
      title: `Make #${channel.name} an announcement channel?`,
      body: "Members will still read and react, but they won't be able to send, reply or edit their earlier messages here. Bots in the space can still post.",
      action: "Make announcement channel",
    });
    if (!ok) return;
  }
  try {
    await chatClient.updateChannel({
      channelId: channel.id,
      postPolicy: on ? ChannelPostPolicy.ADMINS : ChannelPostPolicy.EVERYONE,
    });
    await queryClient.invalidateQueries({
      queryKey: ["channels", channel.spaceId],
    });
  } catch (err) {
    notice({ title: "Couldn't update the channel", body: errorText(err) });
  }
}

// Mutes or unmutes a channel for the caller, and brings the badges along.
export async function setChannelMuted(
  queryClient: QueryClient,
  channel: Channel,
  muted: boolean,
) {
  const res = await chatClient.setChannelMuted({
    channelId: channel.id,
    muted,
  });
  const now = res.channel?.muted ?? muted;
  patchChannel(queryClient, channel.spaceId, channel.id, { muted: now });
  // A text channel's row leaves or rejoins the sidebar, which a screen
  // reader would otherwise not hear about.
  if (channel.spaceId && channel.kind !== ChannelKind.VOICE) {
    announce(
      now
        ? `#${channel.name} muted. Find it under Muted channels.`
        : `#${channel.name} unmuted.`,
    );
  }
  recomputeSpaceUnread(queryClient, channel.spaceId);
  // The mute stamps on items already in the feed are now stale.
  queryClient.invalidateQueries({ queryKey: ["activity"] });
}
