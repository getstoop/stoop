import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import { LockIcon } from "./Icons";

// A channel's name inside a sentence: a lock before a private channel's,
// a hash before any other. channelNameText (api/channels.ts) is the same
// for places that take only a string.
export function ChannelName({
  channel,
}: {
  channel: Pick<Channel, "name" | "private">;
}) {
  if (!channel.private) {
    return <span className="channel-name-text">#{channel.name}</span>;
  }
  return (
    <span className="channel-name-text">
      <LockIcon />
      <span className="visually-hidden">Private channel </span>
      {channel.name}
    </span>
  );
}
