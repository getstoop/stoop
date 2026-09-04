import { fileUrl } from "../api/files";
import type { LinkPreview } from "../gen/stoop/chat/v1/message_pb";

// Open Graph cards for links in a message. The server fetched and
// re-encoded everything here — the image is served from our own origin —
// so rendering a card never contacts the linked site.
export function LinkPreviews({ previews }: { previews: LinkPreview[] }) {
  if (previews.length === 0) return null;
  return (
    <div className="link-previews">
      {previews.map((p) => (
        <LinkPreviewCard key={p.url} preview={p} />
      ))}
    </div>
  );
}

function LinkPreviewCard({ preview: p }: { preview: LinkPreview }) {
  let host = "";
  try {
    host = new URL(p.url).host.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const imageOnly = !p.title && p.imageFileId;
  const landscape = p.imageWidth >= p.imageHeight * 1.3;
  return (
    <a
      className={`link-preview ${imageOnly ? "image-only" : ""} ${landscape ? "landscape" : ""}`}
      href={p.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {!imageOnly && (
        <span className="link-preview-text">
          <span className="link-preview-site">{p.siteName || host}</span>
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
