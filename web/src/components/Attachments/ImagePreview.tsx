import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { fileUrl } from "../../api/files";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";
import { BackIcon, CloseIcon, DownloadIcon, ForwardIcon } from "../Icons";

// An image over a scrim, at its own size or as large as the window
// allows. Escape, the close button and a click on the scrim close it.
// The arrows and the arrow keys step through the images around it. On
// the body, so a transformed ancestor (the side panel) can't clip it.
export function ImagePreview({
  attachment: a,
  onPrevious,
  onNext,
  onClose,
}: {
  attachment: Attachment;
  // Absent at that end of the list.
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const download = useRef<HTMLAnchorElement>(null);

  const handlers = useRef({ onPrevious, onNext, onClose });
  handlers.current = { onPrevious, onNext, onClose };
  useEffect(() => {
    // Capture, so Escape closes the preview and not the panel behind it.
    const onKey = (e: KeyboardEvent) => {
      const { onPrevious, onNext, onClose } = handlers.current;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrevious?.();
      else if (e.key === "ArrowRight") onNext?.();
      else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    download.current?.focus();
    return () => opener?.focus();
  }, []);

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape (handled above)
    <div
      className="image-preview"
      role="dialog"
      aria-modal="true"
      aria-label={a.name}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="image-preview-frame">
        <img key={a.fileId} src={fileUrl(a.fileId)} alt={a.name} />
        {onPrevious && (
          <button
            type="button"
            className="chip image-preview-step image-preview-previous"
            onClick={onPrevious}
            aria-label="Previous image"
          >
            <BackIcon />
          </button>
        )}
        {onNext && (
          <button
            type="button"
            className="chip image-preview-step image-preview-next"
            onClick={onNext}
            aria-label="Next image"
          >
            <ForwardIcon />
          </button>
        )}
      </div>
      <button
        type="button"
        className="chip image-preview-close"
        onClick={onClose}
        aria-label="Close"
      >
        <CloseIcon />
      </button>
      <a
        ref={download}
        className="chip image-preview-download"
        href={fileUrl(a.fileId)}
        download={a.name}
        title={`Download ${a.name}`}
      >
        <DownloadIcon />
        Download
      </a>
    </div>,
    document.body,
  );
}
