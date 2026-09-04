import { fileUrl, formatBytes } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { DownloadIcon } from "../Icons";

// The same name / size / download row an inline image has, but always
// visible: the player's controls sit where the image's hover bar would.
export function MediaCaption({ attachment: a }: { attachment: Attachment }) {
  return (
    <figcaption className="attachment-bar attachment-bar-static">
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
