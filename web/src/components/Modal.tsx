import { type ReactNode, useEffect, useId, useRef } from "react";

// Open modals, in the order they opened.
const openModals: symbol[] = [];

// The modal frame: a scrim, a panel, a titled header with a close button,
// and an optional footer of actions. Escape and a click on the scrim
// close it; focus moves inside on open and back to where it was on
// close. Content decides its own layout (a form, a list, a paragraph).
export function Modal({
  title,
  onClose,
  children,
  footer,
  small,
  kind,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  // A narrower panel for a question with one answer.
  small?: boolean;
  // Stamped as data-dialog, so specs can tell a confirm from a prompt.
  kind?: "confirm" | "prompt" | "notice";
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Escape closes the topmost modal only: a notice over a dialog that
  // shows a secret once must not take that dialog with it.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const id = Symbol();
    openModals.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openModals.at(-1) === id) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
    };
  }, []);

  // Focus moves inside on open — to whatever the content marked
  // autoFocus, else the first field or button — and back to the opener
  // on close, so a keyboard user is not stranded.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) {
      const first = panel.current?.querySelector<HTMLElement>(
        "input, select, textarea, button:not([aria-label='Close'])",
      );
      (first ?? panel.current)?.focus();
    }
    return () => opener?.focus();
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: scrim click-to-close; Escape handled above
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape (handled above)
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`modal ${small ? "small" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dialog={kind}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        {children}
        {footer && <footer className="modal-actions">{footer}</footer>}
      </div>
    </div>
  );
}
