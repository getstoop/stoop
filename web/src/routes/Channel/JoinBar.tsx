import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { joinChannel } from "../../api/channels";
import { errorText } from "../../api/errors";
import type { Channel } from "../../gen/stoop/chat/v1/channel_pb";

// Where the composer would be, for someone in the space who has not
// joined this channel.
export function JoinBar({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="join-bar">
      <p>
        <strong>You are not in #{channel.name}.</strong> Join to post and react.
        {error && (
          <span className="error" role="alert">
            {" "}
            {error}
          </span>
        )}
      </p>
      <button
        type="button"
        className="primary"
        disabled={joining}
        onClick={join}
      >
        Join channel
      </button>
    </div>
  );
}
