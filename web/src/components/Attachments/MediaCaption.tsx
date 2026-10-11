import { fileUrl, formatBytes } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { DownloadIcon } from "../Icons";

// An attachment's name, size and download. Over the bottom of an image
// or a video's still it shows on hover; an audio player's is always
// visible, since its controls sit where the hover bar would.
export function MediaCaption({
  attachment: a,
  overlay = false,
}: {
  attachment: Attachment;
  overlay?: boolean;
}) {
  return (
    <figcaption
      className={`attachment-bar${overlay ? "" : " attachment-bar-static"}`}
    >
      <span className="attachment-name">{a.name}</span>
      <span className="attachment-size">{formatBytes(a.size)}</span>
      <a
        className="attachment-download"
        href={fileUrl(a.fileId)}
        download={a.name}
        title={`Download ${a.name}`}
        aria-label={`Download ${a.name}`}
      >
        <DownloadIcon />
      </a>
    </figcaption>
  );
}
