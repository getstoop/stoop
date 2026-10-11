import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { joinChannel } from "../../api/channels";
import { errorText } from "../../api/errors";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";

// One channel on the channel list page: what it is for, how many people
// are in it, and Join for someone who is not.
export function BrowserRow({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people =
    channel.memberCount === 1 ? "1 person" : `${channel.memberCount} people`;

  const join = async () => {
    setError(null);
    setJoining(true);
    try {
      await joinChannel(queryClient, channel);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <li className="channel-browser-row">
      <div className="channel-browser-text">
        <Link
          to="/s/$spaceId/c/$channelId"
          params={{ spaceId: channel.spaceId, channelId: channel.id }}
          className="channel-browser-name"
        >
          # {channel.name}
        </Link>
        {channel.topic && (
          <span className="channel-browser-topic">{channel.topic}</span>
        )}
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
      {channel.required && <span className="badge">Everyone</span>}
      <span className="channel-browser-count">{people}</span>
      <div className="channel-browser-state">
        {channel.joined ? (
          <span className="muted">Joined</span>
        ) : (
          <button
            type="button"
            className="chip"
            disabled={joining}
            onClick={join}
            aria-label={`Join #${channel.name}`}
          >
            Join
          </button>
        )}
      </div>
    </li>
  );
}
