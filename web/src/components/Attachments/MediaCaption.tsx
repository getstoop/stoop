import { fileUrl, formatBytes } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { DownloadIcon } from "../Icons";

// An attachment's name, size and download. `overlay` lays it over the
// bottom of an image (shown on hover) or a video's still (always shown);
// an audio player's sits in a row of its own.
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
