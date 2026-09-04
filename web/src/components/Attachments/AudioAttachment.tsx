import { useState } from "react";
import { fileUrl } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { AttachmentCard } from "./AttachmentCard";
import { MediaCaption } from "./MediaCaption";

// An audio attachment as a player; see VideoAttachment for why it streams
// lazily and falls back to the download card on a playback error.
export function AudioAttachment({ attachment: a }: { attachment: Attachment }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <AttachmentCard attachment={a} />;
  return (
    <figure className="attachment-audio">
      <MediaCaption attachment={a} />
      <audio
        controls
        preload="metadata"
        src={fileUrl(a.fileId)}
        onError={() => setFailed(true)}
      >
        <track kind="captions" />
      </audio>
    </figure>
  );
}
