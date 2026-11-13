import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";

// The rules of a channel's menu on the Spaces tab: what it offers, in
// order, as web's channel menu words it.

export type ChannelAction = "mute" | "copyLink" | "about";

export type ChannelMenuItem = {
  action: ChannelAction;
  label: string;
  // Shown, but takes no press.
  disabled: boolean;
};

// What the channel says it is for, or "" when it says nothing.
export function channelTopic(channel: Pick<Channel, "topic">): string {
  return channel.topic.trim();
}

// A channel's items, a voice room's too. A muted space mutes all of its
// channels, and a channel cannot be louder than its space: the mute
// item says so and is inert. About this channel is there only for a
// channel with a topic to read.
export function channelMenuItems(channel: Pick<Channel, "muted" | "topic">, spaceMuted: boolean): ChannelMenuItem[] {
  const items: ChannelMenuItem[] = [
    spaceMuted
      ? { action: "mute", label: "Muted by space", disabled: true }
      : { action: "mute", label: channel.muted ? "Unmute" : "Mute", disabled: false },
    { action: "copyLink", label: "Copy link", disabled: false },
  ];
  if (channelTopic(channel)) items.push({ action: "about", label: "About this channel", disabled: false });
  return items;
}

// The same for a screen reader, as the row's own actions: only what can
// be done.
export function channelRowActions(
  channel: Pick<Channel, "muted" | "topic">,
  spaceMuted: boolean,
): { name: ChannelAction; label: string }[] {
  return channelMenuItems(channel, spaceMuted)
    .filter((item) => !item.disabled)
    .map((item) => ({ name: item.action, label: item.label }));
}
