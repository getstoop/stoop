import { type KeyboardEvent, type RefObject, useCallback } from "react";
import { applyFormat, type Format, shortcutFormat } from "../api/formatting";

// Wires applyFormat to a controlled textarea: reads the live selection,
// writes the result straight into the element (value and selection) and
// then into state. Because the DOM already holds the new value when React
// re-renders, the caret stays where we put it — no deferred fix-up, so
// keystrokes right after a shortcut land inside the markers. Returns the
// apply function and a keydown handler for the shortcuts (which reports
// whether it consumed the key).
export function useFormatting(
  ref: RefObject<HTMLTextAreaElement | null>,
  setValue: (value: string) => void,
) {
  const apply = useCallback(
    (format: Format) => {
      const el = ref.current;
      if (!el) return;
      const edit = applyFormat(
        el.value,
        el.selectionStart,
        el.selectionEnd,
        format,
      );
      el.value = edit.value;
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
      setValue(edit.value);
    },
    [ref, setValue],
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
  return { apply, onShortcut };
}
