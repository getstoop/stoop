import { fileUrl } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { usePreview } from "./gallery";
import { MediaCaption } from "./MediaCaption";
import { MediaPreview } from "./MediaPreview";

// An inline image, drawn from its thumbnail when the server made one:
// click for the preview (the original), hover for the name and download.
export function ImageAttachment({ attachment: a }: { attachment: Attachment }) {
  const preview = usePreview(a);
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
