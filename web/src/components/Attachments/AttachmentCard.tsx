import { fileUrl, formatBytes } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { FileIcon } from "../Icons";

// The download card: what any file gets when it can't be shown inline.
export function AttachmentCard({ attachment: a }: { attachment: Attachment }) {
  return (
    <a className="attachment-card" href={fileUrl(a.fileId)} download={a.name}>
      <FileIcon />
      <span className="attachment-name">{a.name}</span>
      <span className="attachment-size">{formatBytes(a.size)}</span>
    </a>
  );
}
