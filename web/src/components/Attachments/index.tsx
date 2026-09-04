import {
  fileUrl,
  formatBytes,
  isInlineImage,
  isPlayableAudio,
  isPlayableVideo,
} from "../../api/files";
import { plainText } from "../../api/markdown";
import type { Attachment, Message } from "../../gen/stoop/chat/v1/message_pb";
import { DownloadIcon } from "../Icons";
import { AttachmentCard } from "./AttachmentCard";
import { AudioAttachment } from "./AudioAttachment";
import { VideoAttachment } from "./VideoAttachment";

// A message's attachments, rendered under its body: raster images inline
// (click for full size; a hover bar names the file and downloads it),
// video and audio as a player, anything else as a download card.
// Attachments are a separate field on the message, never part of the
// Markdown.
export function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachments">
      {attachments.map((a) =>
        isPlayableVideo(a.contentType) ? (
          <VideoAttachment key={a.fileId} attachment={a} />
        ) : isPlayableAudio(a.contentType) ? (
          <AudioAttachment key={a.fileId} attachment={a} />
        ) : isInlineImage(a.contentType) ? (
          <ImageAttachment key={a.fileId} attachment={a} />
        ) : (
          <AttachmentCard key={a.fileId} attachment={a} />
        ),
      )}
    </div>
  );
}

// An inline image: click for full size, hover for the name and download.
function ImageAttachment({ attachment: a }: { attachment: Attachment }) {
  return (
    <figure className="attachment-image">
      <a
        href={fileUrl(a.fileId)}
        target="_blank"
        rel="noreferrer"
        title="Open full size"
      >
        <img src={fileUrl(a.fileId)} alt={a.name} loading="lazy" />
      </a>
      <figcaption className="attachment-bar">
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
    </figure>
  );
}

// One-line form of a message for the reply bar: its text, or its first
// file's name when it has none (the server does the same for quotes and
// activity previews).
export function messagePreview(m: Message): string {
  const text = plainText(m.content);
  if (text) return text;
  const first = m.attachments[0];
  return first ? `📎 ${first.name}` : "";
}
