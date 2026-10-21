import {
  isInlineImage,
  isPlayableAudio,
  isPlayableVideo,
} from "../../api/files";
import { plainText } from "../../core/markdown";
import type { Attachment, Message } from "../../gen/stoop/chat/v1/message_pb";
import { AttachmentCard } from "./AttachmentCard";
import { AudioAttachment } from "./AudioAttachment";
import { ExpiredAttachment } from "./ExpiredAttachment";
import { ImageAttachment } from "./ImageAttachment";
import { VideoAttachment } from "./VideoAttachment";

export { GalleryMedia, galleryMedia } from "./gallery";

// A message's attachments, rendered under its body: raster images inline
// (click for a preview; a hover bar names the file and downloads it),
// video as a frame that plays in the same preview, audio as a player,
// anything else as a download card.
// Attachments are a separate field on the message, never part of the
// Markdown.
export function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachments">
      {attachments.map((a) =>
        a.expired ? (
          <ExpiredAttachment key={a.fileId} attachment={a} />
        ) : isPlayableVideo(a.contentType) ? (
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

// One-line form of a message for the reply bar: its text, or its first
// file's name when it has none (the server does the same for quotes and
// activity previews).
export function messagePreview(m: Message): string {
  const text = plainText(m.content);
  if (text) return text;
  const first = m.attachments[0];
  if (!first) return "";
  return first.expired ? "📎 Expired attachment" : `📎 ${first.name}`;
}
