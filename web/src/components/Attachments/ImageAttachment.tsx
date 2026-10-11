import { fileUrl, formatBytes } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { DownloadIcon } from "../Icons";
import { usePreview } from "./gallery";
import { MediaPreview } from "./MediaPreview";

// An inline image: click for the preview, hover for the name and download.
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
        <img src={fileUrl(a.fileId)} alt={a.name} loading="lazy" />
      </button>
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
