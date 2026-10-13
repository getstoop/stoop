import { useState } from "react";
import { fileUrl } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { PlayIcon } from "../Icons";
import { AttachmentCard } from "./AttachmentCard";
import { usePreview } from "./gallery";
import { MediaCaption } from "./MediaCaption";
import { MediaPreview } from "./MediaPreview";

// A video attachment: its first frame in chat, and a click plays it in
// the preview. The server serves the bytes as uploaded (no transcoding)
// with Range support; preload="metadata" fetches only the header, so a
// channel full of clips doesn't download them all. Whether a file decodes
// is the browser's call — an HEVC .mov plays in Safari and not in
// Firefox — so an error swaps the frame for the ordinary download card.
export function VideoAttachment({ attachment: a }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  const preview = usePreview(a);
  if (failed) return <AttachmentCard attachment={a} />;
  return (
    <figure className="attachment-video">
      <button
        type="button"
        title="Play"
        aria-label={`Play ${a.name}`}
        aria-haspopup="dialog"
        onClick={preview.open}
      >
        <video
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          src={fileUrl(a.fileId)}
          onError={() => setFailed(true)}
        >
          <track kind="captions" />
        </video>
        <span className="attachment-video-play">
          <PlayIcon />
        </span>
      </button>
      <MediaCaption attachment={a} overlay />
      {preview.shown && (
        <MediaPreview
          attachment={preview.shown}
          onPrevious={preview.onPrevious}
          onNext={preview.onNext}
          onClose={preview.close}
        />
      )}
    </figure>
  );
}
