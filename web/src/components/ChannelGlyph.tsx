import { isAnnouncement } from "../api/channels";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import { MegaphoneIcon } from "./Icons";

// The mark before a text channel's name: # or, for an announcement
// channel, a megaphone.
export function ChannelGlyph({ channel }: { channel: Channel | undefined }) {
  if (!isAnnouncement(channel)) return <span className="channel-hash">#</span>;
  return (
    <span className="channel-hash" title="Announcement channel">
      <MegaphoneIcon />
    </span>
  );
}
