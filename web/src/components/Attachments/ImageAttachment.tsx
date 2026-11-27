import type { CSSProperties } from "react";
import { fileUrl } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { usePreview } from "./gallery";
import { MediaCaption } from "./MediaCaption";
import { MediaPreview } from "./MediaPreview";

// An inline image, drawn from its thumbnail when the server made one:
// click for the preview (the original), hover for the name and download.
// With the size the server measured, the image holds its box before it
// loads (attachments.css), so the row doesn't grow under the reader when
// it lands.
export function ImageAttachment({ attachment: a }: { attachment: Attachment }) {
  const preview = usePreview(a);
  const sized = a.width > 0 && a.height > 0;
  return (
    <figure className="attachment-image">
      <button
        type="button"
        title="Preview"
        aria-haspopup="dialog"
        onClick={preview.open}
      >
        <img
          src={fileUrl(a.thumbnailFileId || a.fileId)}
          alt={a.name}
          width={sized ? a.width : undefined}
          height={sized ? a.height : undefined}
          style={
            sized
              ? ({ "--w": a.width, "--h": a.height } as CSSProperties)
              : undefined
          }
          loading="lazy"
        />
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
