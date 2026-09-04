import type { QueryClient } from "@tanstack/react-query";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { notice, prompt } from "../stores/dialogs";
import { chatClient } from "./clients";
import { errorText } from "./errors";

// The channels a space may point new arrivals at. Voice is excluded here
// and again on the server: landing someone in a voice channel would open
// a microphone they never asked to open.
export function defaultChannelChoices(channels: Channel[]): Channel[] {
  return channels.filter((c) => c.kind === ChannelKind.TEXT);
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
  return chosen ?? channels[0];
}

// The server's own limit, mirrored so the field counts down rather than
// let a save fail (internal/chat/channels.go).
export const MAX_CHANNEL_TOPIC = 250;

// Ask for a channel's topic and save it. Shared by the three places that
// offer the edit — the header, the channel's ⋮ and space settings — so
// they can't drift apart. Clearing the field removes the topic, which is
// why an empty answer is a real answer here and only null means cancel.
export async function editChannelTopic(
  channel: Channel,
  queryClient: QueryClient,
): Promise<void> {
  const topic = await prompt({
    title: `Topic for #${channel.name}`,
    body: "One line, shown in the channel header. Plain text.",
    label: "Topic",
    initial: channel.topic,
    placeholder: "Borrow anything on the shelf — sign it out here.",
    action: "Save",
    multiline: true,
    maxLength: MAX_CHANNEL_TOPIC,
    allowEmpty: true,
  });
  if (topic === null || topic === channel.topic) return;
  try {
    await chatClient.updateChannel({ channelId: channel.id, topic });
    await queryClient.invalidateQueries({
      queryKey: ["channels", channel.spaceId],
    });
  } catch (err) {
    notice({ title: "Couldn't save the topic", body: errorText(err) });
  }
}
