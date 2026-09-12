import { Navigate } from "@tanstack/react-router";
import { useDirectMessages } from "../../api/dms";

// /dm with nothing picked: the most recent conversation, or a hint.
export function DMIndex() {
  const { data: dms, isLoading } = useDirectMessages();
  if (isLoading) {
    return <div className="centered muted">Loading…</div>;
  }
  const first = dms?.[0]?.channel;
  if (first) {
    return <Navigate to="/dm/$channelId" params={{ channelId: first.id }} />;
  }
  return (
    <div className="centered">
      <div className="empty-state">
        <h2>Direct messages</h2>
        <p className="muted">
          Start one with the + beside "Direct messages", or open someone's
          profile from a message and choose Message.
        </p>
      </div>
    </div>
  );
}
