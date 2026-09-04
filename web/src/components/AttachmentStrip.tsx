import { formatBytes } from "../api/files";

// A file the composer is holding: uploading, ready (has a fileId), or
// failed. previewUrl is an object URL for images, revoked by the owner.
export type PendingAttachment = {
  key: string;
  name: string;
  size: number;
  contentType: string;
  previewUrl?: string;
  fileId?: string;
  error?: string;
};

export function AttachmentStrip({
  items,
  error,
  onRemove,
}: {
  items: PendingAttachment[];
  error: string | null;
  onRemove: (key: string) => void;
}) {
  if (items.length === 0 && !error) return null;
  return (
    <div className="attachment-strip">
      {items.map((p) => (
        <div
          key={p.key}
          className={`pending ${p.error ? "failed" : p.fileId ? "ready" : "uploading"}`}
          title={p.error ?? `${p.name} · ${formatBytes(p.size)}`}
        >
          {p.previewUrl ? (
            <img src={p.previewUrl} alt="" className="pending-thumb" />
          ) : (
            <span className="pending-thumb pending-file" aria-hidden="true">
              📄
            </span>
          )}
          <span className="pending-name">{p.name}</span>
          <span className="pending-meta">
            {p.error ? p.error : p.fileId ? formatBytes(p.size) : "uploading…"}
          </span>
          <button
            type="button"
            className="icon-button pending-remove"
            onClick={() => onRemove(p.key)}
            aria-label={`Remove ${p.name}`}
            title="Remove"
          >
            ✕
          </button>
        </div>
      ))}
      {error && (
        <p className="error attachment-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
