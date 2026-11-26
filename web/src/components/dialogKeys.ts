import type { KeyboardEvent } from "react";

// Whether a key belongs to an input method's composition rather than to
// the field: Enter that confirms a conversion, Backspace that edits it.
// WebKit sends the Enter that ends a composition with isComposing false
// and keyCode 229, so both are asked.
export const composing = (event: KeyboardEvent): boolean =>
  composingKey(event.nativeEvent);

// The same, for a listener on the window or the document.
export const composingKey = (event: globalThis.KeyboardEvent): boolean =>
  event.isComposing || event.keyCode === 229;

// Tab and Shift+Tab go round the form's own controls while it is open,
// never out to the page behind it. Bound on an element holding the
// whole dialog.
export function keepFocusIn(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const stops = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "input:not(:disabled), button:not(:disabled)",
    ),
  );
  if (stops.length === 0) return;
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const last = stops.length - 1;
  if (event.shiftKey ? at <= 0 : at === last || at < 0) {
    event.preventDefault();
    stops[event.shiftKey ? last : 0].focus();
  }
}
