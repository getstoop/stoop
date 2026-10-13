import type { ReactNode } from "react";
import { MegaphoneIcon } from "../../components/Icons";

// Where the composer would be, for someone who can't post in an
// announcement channel.
export function PostingClosed({ channelName }: { channelName: ReactNode }) {
  return (
    <div className="posting-closed">
      <MegaphoneIcon />
      <p>
        <strong>{channelName} is an announcement channel.</strong> Only admins
        post here; you can still react.
      </p>
    </div>
  );
}
