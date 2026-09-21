import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  CHANNEL_NAME_HINT,
  editChannelTopic,
  isAnnouncement,
  setAnnouncement,
} from "../api/channels";
import { chatClient } from "../api/clients";
import { errorText } from "../api/errors";
import { canManageChannels } from "../api/permissions";
import {
  channelPath,
  copyShareLink,
  shareOrigin,
  shareUrl,
} from "../api/shareLinks";
import { patchChannel, recomputeSpaceUnread } from "../api/unreads";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { confirm, notice, prompt } from "../stores/dialogs";
import { ChannelAbout } from "./ChannelAbout";
import { DotsMenu, type MenuItem } from "./DotsMenu";

// The ⋮ on a channel row: mute/unmute for anyone who can read it (a DM
// too), and for people who manage the space, rename and delete. Shown on
// hover (always on touch screens; channel-menu.css).
export function ChannelMenu({
  channel,
  space,
}: {
  channel: Channel;
  // Absent for a direct message: only mute applies.
  space?: Space;
}) {
  const queryClient = useQueryClient();
  const [aboutOpen, setAboutOpen] = useState(false);
  const spaceId = channel.spaceId;
  const manage = !!space && canManageChannels(space);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      notice({ title: "Couldn't update the channel", body: errorText(err) });
    }
  };

  const toggleMute = () =>
    run(async () => {
      const res = await chatClient.setChannelMuted({
        channelId: channel.id,
        muted: !channel.muted,
      });
      const muted = res.channel?.muted ?? !channel.muted;
      patchChannel(queryClient, spaceId, channel.id, { muted });
      recomputeSpaceUnread(queryClient, spaceId);
      // The mute stamps on items already in the feed are now stale.
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    });

  const copyLink = () =>
    copyShareLink(
      shareUrl(channelPath(spaceId, channel.id), shareOrigin(queryClient)),
    );

  const rename = () =>
    run(async () => {
      await prompt({
        title: "Rename channel",
        label: "Channel name",
        body: CHANNEL_NAME_HINT,
        initial: channel.name,
        action: "Rename",
        submit: async (name) => {
          if (name === channel.name) return;
          await chatClient.updateChannel({ channelId: channel.id, name });
        },
      });
    });

  const remove = () =>
    run(async () => {
      const ok = await confirm({
        title: `Delete #${channel.name}?`,
        body: "All its messages go with it.",
        action: "Delete",
        danger: true,
      });
      if (!ok) return;
      await chatClient.deleteChannel({ channelId: channel.id });
      await queryClient.invalidateQueries({ queryKey: ["channels", spaceId] });
    });

  // A muted space mutes all of its channels, and with two states a
  // channel cannot be louder than its space: the item says so and is inert.
  const items: MenuItem[] = space?.muted
    ? [{ label: "Muted by space", onSelect: () => {}, disabled: true }]
    : [{ label: channel.muted ? "Unmute" : "Mute", onSelect: toggleMute }];
  items.push({ label: "Copy link", onSelect: copyLink, done: "Copied!" });
  // A conversation can be taken off the list without any judgement about
  // the people in it; the next message puts it back.
  if (!spaceId) {
    items.push({
      label: "Close conversation",
      onSelect: () =>
        run(async () => {
          await chatClient.setDirectMessageClosed({
            channelId: channel.id,
            closed: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["dms"] });
        }),
    });
  }
  // The one way to read a topic on a phone, where the header hides it.
  if (channel.topic) {
    items.push({
      label: "About this channel",
      onSelect: () => setAboutOpen(true),
    });
  }
  if (manage) {
    items.push(
      { label: "Edit name", onSelect: rename },
      {
        label: channel.topic ? "Edit topic" : "Add a topic",
        onSelect: () => editChannelTopic(channel, queryClient),
      },
    );
    if (channel.kind === ChannelKind.TEXT) {
      const on = isAnnouncement(channel);
      items.push({
        label: on ? "Let everyone post" : "Make announcement channel",
        onSelect: () => setAnnouncement(channel, !on, queryClient, true),
      });
    }
    items.push({ label: "Delete channel", onSelect: remove, danger: true });
  }

  return (
    <>
      <DotsMenu
        className="channel-menu-anchor"
        label={`Options for ${channel.name || "this conversation"}`}
        items={items}
      />
      {aboutOpen && (
        <ChannelAbout
          channel={channel}
          space={space}
          onClose={() => setAboutOpen(false)}
        />
      )}
    </>
  );
}
