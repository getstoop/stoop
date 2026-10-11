import { useContext, useState } from "react";
import { fileUrl, formatBytes } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { DownloadIcon } from "../Icons";
import { GalleryImages } from "./gallery";
import { ImagePreview } from "./ImagePreview";

// An inline image: click for the preview, hover for the name and download.
export function ImageAttachment({ attachment: a }: { attachment: Attachment }) {
  // The file the preview is on: this one, until the arrows move it.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const images = useContext(GalleryImages) ?? [a];
  const index = images.findIndex((image) => image.fileId === previewId);
  const previous = images[index - 1];
  const next = images[index + 1];
  return (
    <figure className="attachment-image">
      <button
        type="button"
        title="Preview"
        aria-haspopup="dialog"
        onClick={() => setPreviewId(a.fileId)}
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
      {index >= 0 && (
        <ImagePreview
          attachment={images[index]}
          onPrevious={previous && (() => setPreviewId(previous.fileId))}
          onNext={next && (() => setPreviewId(next.fileId))}
          onClose={() => setPreviewId(null)}
        />
      )}
    </figure>
  );
}
