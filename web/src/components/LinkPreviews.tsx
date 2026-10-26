import { fileUrl } from "../api/files";
import { useServerOrigins } from "../api/queries";
import { previewShape, previewSite, shownPreviews } from "../core/linkPreviews";
import type { LinkPreview } from "../gen/stoop/chat/v1/message_pb";
import { CloseIcon } from "./Icons";

// Open Graph cards for links in a message. The server fetched and
// re-encoded everything here — the image is served from our own origin —
// so rendering a card never contacts the linked site.
// A link to a message on this server gets a LinkedMessages card instead.
// onDismiss, for whoever may delete the message, offers a × on each card.
export function LinkPreviews({
  previews,
  onDismiss,
}: {
  previews: LinkPreview[];
  onDismiss?: (url: string) => void;
}) {
  const shown = shownPreviews(previews, useServerOrigins());
  if (shown.length === 0) return null;
  return (
    <div className="link-previews">
      {shown.map((p) => (
        <div key={p.url} className="link-preview-card">
          <LinkPreviewCard preview={p} />
          {onDismiss && (
            <button
              type="button"
              className="icon-button link-preview-dismiss"
              aria-label="Remove preview"
              title="Remove preview"
              onClick={() => onDismiss(p.url)}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function LinkPreviewCard({ preview: p }: { preview: LinkPreview }) {
  const { imageOnly, landscape } = previewShape(p);
  return (
    <a
      className={`link-preview ${imageOnly ? "image-only" : ""} ${landscape ? "landscape" : ""}`}
      href={p.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {!imageOnly && (
        <span className="link-preview-text">
          <span className="link-preview-site">{previewSite(p)}</span>
          <span className="link-preview-title">{p.title}</span>
          {p.description && (
            <span className="link-preview-description">{p.description}</span>
          )}
        </span>
      )}
      {p.imageFileId && (
        <img
          className="link-preview-image"
          src={fileUrl(p.imageFileId)}
          alt=""
          width={p.imageWidth || undefined}
          height={p.imageHeight || undefined}
          loading="lazy"
        />
      )}
    </a>
  );
}
