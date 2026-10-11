import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { setChannelMuted } from "../../api/channels";
import { errorText } from "../../api/errors";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";
import { notice } from "../../stores/dialogs";
import { ChannelGlyph } from "../ChannelGlyph";
import { BellOffIcon } from "../Icons";
import { Tooltip } from "../Tooltip";

// One muted channel: its name opens it, and Unmute puts its row back in
// the sidebar.
export function MutedRow({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient();

  const unmute = async () => {
    try {
      await setChannelMuted(queryClient, channel, false);
    } catch (err) {
      notice({ title: "Couldn't update the channel", body: errorText(err) });
    }
  };

  return (
    <li className="muted-row">
      <Link
        to="/s/$spaceId/c/$channelId"
        params={{ spaceId: channel.spaceId, channelId: channel.id }}
        className="muted-open"
        activeProps={{ className: "muted-open active" }}
      >
        <span className="muted-name">
          <ChannelGlyph channel={channel} />
          {channel.name}
        </span>
        {channel.topic && <span className="muted-topic">{channel.topic}</span>}
      </Link>
      <Tooltip text="Unmute" side="left">
        <button
          type="button"
          className="icon-button muted-unmute"
          aria-label={`Unmute ${channel.name}`}
          onClick={unmute}
        >
          <BellOffIcon size={16} />
        </button>
      </Tooltip>
    </li>
  );
}
