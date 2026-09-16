import { formatBytes } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { FileIcon } from "../Icons";

// A file the server's attachment retention deleted: no bytes and no name,
// only that something was here and how big it was.
export function ExpiredAttachment({
  attachment: a,
}: {
  attachment: Attachment;
}) {
  return (
    <div className="attachment-expired">
      <FileIcon />
      <span>Expired attachment · {formatBytes(a.size)}</span>
    </div>
  );
}
