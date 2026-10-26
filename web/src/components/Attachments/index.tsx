import { attachmentKind } from "../../core/attachments";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
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
      {attachments.map((attachment) => (
        <AttachmentOfKind key={attachment.fileId} attachment={attachment} />
      ))}
    </div>
  );
}

function AttachmentOfKind({ attachment }: { attachment: Attachment }) {
  switch (attachmentKind(attachment)) {
    case "expired":
      return <ExpiredAttachment attachment={attachment} />;
    case "video":
      return <VideoAttachment attachment={attachment} />;
    case "audio":
      return <AudioAttachment attachment={attachment} />;
    case "image":
      return <ImageAttachment attachment={attachment} />;
    case "file":
      return <AttachmentCard attachment={attachment} />;
  }
}
