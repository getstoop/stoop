import { createPortal } from "react-dom";
import { useAnnouncerStore } from "../stores/announcer";

// The hidden live region behind announce(): a screen reader speaks its
// text when it changes, without moving focus. On the body, so nothing
// that makes part of the app inert silences it.
export function Announcer() {
  const message = useAnnouncerStore((state) => state.message);
  return createPortal(
    <div className="visually-hidden" role="status" aria-live="polite">
      {message}
    </div>,
    document.body,
  );
}
