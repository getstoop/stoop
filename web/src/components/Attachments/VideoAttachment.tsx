import { useState } from "react";
import { fileUrl } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { AttachmentCard } from "./AttachmentCard";
import { MediaCaption } from "./MediaCaption";

// A video attachment as a player. The server serves the bytes as uploaded
// (no transcoding) with Range support, so the browser streams and seeks;
// preload="metadata" fetches only the header until the user presses play,
// so a channel full of clips doesn't download them all. Whether a file
// decodes is the browser's call — an HEVC .mov plays in Safari and not in
// Firefox — so a playback error swaps the player for the ordinary
// download card.
export function VideoAttachment({ attachment: a }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <AttachmentCard attachment={a} />;
  return (
    <figure className="attachment-video">
      <video
        controls
        preload="metadata"
        playsInline
        src={fileUrl(a.fileId)}
        onError={() => setFailed(true)}
      >
        <track kind="captions" />
      </video>
      <MediaCaption attachment={a} />
    </figure>
  );
}
