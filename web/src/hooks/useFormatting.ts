import {
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
} from "react";
import {
  applyFormat,
  type Edit,
  type Format,
  linkSelection,
  shortcutFormat,
} from "../api/formatting";

// Wires applyFormat to a controlled textarea: reads the live selection,
// writes the result straight into the element (value and selection) and
// then into state. Because the DOM already holds the new value when React
// re-renders, the caret stays where we put it — no deferred fix-up, so
// keystrokes right after a shortcut land inside the markers. Returns the
// apply function, a keydown handler for the shortcuts and a paste handler
// that links selected words to a pasted address (each reports whether it
// consumed the event).
export function useFormatting(
  ref: RefObject<HTMLTextAreaElement | null>,
  setValue: (value: string) => void,
) {
  const write = useCallback(
    (el: HTMLTextAreaElement, edit: Edit) => {
      el.value = edit.value;
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
      setValue(edit.value);
    },
    [setValue],
  );
  const apply = useCallback(
    (format: Format) => {
      const el = ref.current;
      if (!el) return;
      write(
        el,
        applyFormat(el.value, el.selectionStart, el.selectionEnd, format),
      );
    },
    [ref, write],
  );
  const onPasteLink = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>): boolean => {
      const el = e.currentTarget;
      const edit = linkSelection(
        el.value,
        el.selectionStart,
        el.selectionEnd,
        e.clipboardData.getData("text/plain"),
      );
      if (!edit) return false;
      e.preventDefault();
      write(el, edit);
      return true;
    },
    [write],
  );
  const onShortcut = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const format = shortcutFormat(e);
      if (!format) return false;
      e.preventDefault();
      apply(format);
      return true;
    },
    [apply],
  );
  return { apply, onShortcut, onPasteLink };
}
