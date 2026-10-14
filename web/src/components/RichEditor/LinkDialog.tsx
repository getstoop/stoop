import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Field } from "../Field";
import { Input } from "../Input";
import { checkLink } from "./links";

// The link form: the words and the address, over the line it links. Fixed
// to the viewport (a scrolling timeline would clip it), above the caret
// when there's room and below it when not. Enter saves, Escape or a click
// outside cancels.

const HEIGHT = 190;
const WIDTH = 320;

export function LinkDialog({
  at,
  text: initialText,
  href: initialHref,
  editing,
  onSave,
  onCancel,
}: {
  // The caret's box on screen.
  at: { left: number; top: number; bottom: number };
  text: string;
  href: string;
  editing: boolean;
  onSave: (text: string, href: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(initialHref);
  const [errors, setErrors] = useState<{ text?: string; href?: string }>({});
  const ref = useRef<HTMLDivElement>(null);

  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) cancel.current();
    };
    // Later: a double click opens the form on a mousedown still on its way.
    const id = setTimeout(() => window.addEventListener("mousedown", onDown));
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
    };
  }, []);

  const save = () => {
    const found = checkLink(text, href);
    setErrors(found);
    if (!found.text && !found.href) onSave(text, href);
  };

  // Inside the composer's form: Enter would submit it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const left = Math.max(8, Math.min(at.left, window.innerWidth - WIDTH - 8));
  const style: CSSProperties =
    at.top > HEIGHT + 16
      ? { left, bottom: window.innerHeight - at.top + 6 }
      : { left, top: at.bottom + 6 };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Enter and Escape for the fields inside
    <div
      ref={ref}
      className="link-dialog popover"
      role="dialog"
      aria-label={editing ? "Edit link" : "Add link"}
      style={style}
      onKeyDown={onKeyDown}
    >
      <Field label="Text" error={errors.text}>
        <Input
          value={text}
          autoFocus={!initialText}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <Field label="Address" error={errors.href}>
        <Input
          value={href}
          autoFocus={!!initialText}
          placeholder="https://"
          onChange={(e) => setHref(e.target.value)}
        />
      </Field>
      <div className="link-dialog-actions">
        <button type="button" className="chip" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
