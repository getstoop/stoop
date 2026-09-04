import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { editChannelTopic } from "../api/channels";
import { canManageChannels } from "../api/permissions";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { ChannelAbout } from "./ChannelAbout";
import { Tooltip } from "./Tooltip";

// What a channel is for, in its header: one truncated line after the
// name, hover for the whole thing, click for About this channel. A
// manager with nothing set gets the invitation instead. Hidden on phones
// (mobile.css), where the ⋮ still reaches About.
export function ChannelTopic({
  channel,
  space,
}: {
  channel: Channel;
  space?: Space;
}) {
  const queryClient = useQueryClient();
  const [aboutOpen, setAboutOpen] = useState(false);
  const manage = !!space && canManageChannels(space);
  // A direct message has no name to explain and no one to manage it.
  if (channel.kind === ChannelKind.DM) return null;
  if (!channel.topic) {
    if (!manage) return null;
    return (
      <>
        <span className="channel-topic-rule" aria-hidden="true" />
        <button
          type="button"
          className="channel-topic empty"
          onClick={() => editChannelTopic(channel, queryClient)}
        >
          Add a topic
        </button>
      </>
    );
  }
  return (
    <>
      <span className="channel-topic-rule" aria-hidden="true" />
      <Tooltip text={channel.topic} side="bottom">
        <button
          type="button"
          className="channel-topic"
          onClick={() => setAboutOpen(true)}
        >
          {channel.topic}
        </button>
      </Tooltip>
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
