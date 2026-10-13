import { isAnnouncement } from "../api/channels";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import { LockIcon, MegaphoneIcon } from "./Icons";

// The mark before a text channel's name: a lock for a private channel,
// a megaphone for an announcement channel, otherwise #.
export function ChannelGlyph({ channel }: { channel: Channel | undefined }) {
  if (channel?.private) {
    return (
      <span className="channel-hash icon" title="Private channel">
        <LockIcon />
        <span className="visually-hidden">Private channel</span>
      </span>
    );
  }
  if (!isAnnouncement(channel)) return <span className="channel-hash">#</span>;
  return (
    <span className="channel-hash icon" title="Announcement channel">
      <MegaphoneIcon />
      <span className="visually-hidden">Announcement channel</span>
    </span>
  );
}
