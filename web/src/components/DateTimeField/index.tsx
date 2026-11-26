import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { CalendarIcon } from "../Icons";
import { fieldLabel } from "./calendar";
import { Panel } from "./Panel";

// A date and time, picked from Stoop's own panel rather than the
// browser's, which no theme can reach (docs/architecture/design-system.md
// → DateTimeField). The value is what a native date-and-time field holds:
// "" until a day and a time are both chosen, then a local reading,
// "2026-12-12T10:00". min and max take the same form and are applied by
// day: days outside them are dimmed and can't be chosen; the time in them
// is not read, so a form keeps its own check of the time.
//
// The field is a button drawn as a field; it opens the panel under it.
// The value changes as the panel's day and time are chosen; Escape puts
// back the value the panel opened with, and Done, a click outside or
// Enter in the time close it with the value as it stands.
export function DateTimeField({
  value,
  onChange,
  min,
  max,
  id,
  readOnly,
  placeholder = "Pick a date and time",
  note,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  id?: string;
  // Shown and not opened: a form that is sending.
  readOnly?: boolean;
  placeholder?: string;
  // A line at the foot of the panel: the range, in words.
  note?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const field = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  // The value the panel opened with, for Escape to put back.
  const openedWith = useRef(value);
  const valueId = useId();
  const panelId = useId();
  const shown = fieldLabel(value, new Date());

  const show = () => {
    if (readOnly) return;
    openedWith.current = value;
    setOpen(true);
  };
  const close = (focusField: boolean) => {
    setOpen(false);
    if (focusField) field.current?.focus();
  };
  const cancel = () => {
    if (value !== openedWith.current) onChange(openedWith.current);
    close(true);
  };

  // Follows the field while the dialog round it scrolls or the window
  // changes size; closes on a press outside it.
  useEffect(() => {
    if (!open) return;
    const place = () =>
      setAnchor(field.current?.getBoundingClientRect() ?? null);
    place();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  // A form that starts sending while the panel is open takes it away.
  useEffect(() => {
    if (readOnly) setOpen(false);
  }, [readOnly]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      show();
    }
  };

  return (
    <div className="date-time-field" ref={wrapper}>
      <button
        ref={field}
        type="button"
        id={id}
        className={`date-time-field-button${shown ? "" : " empty"}`}
        aria-label={ariaLabel}
        aria-describedby={[valueId, describedBy].filter(Boolean).join(" ")}
        aria-invalid={invalid || undefined}
        aria-disabled={readOnly || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onKeyDown}
      >
        <CalendarIcon />
        <span id={valueId} className="date-time-field-value">
          {shown ?? placeholder}
        </span>
      </button>
      {open && anchor && (
        <Panel
          id={panelId}
          value={value}
          min={min}
          max={max}
          anchor={anchor}
          note={note}
          onChange={onChange}
          onDone={() => close(true)}
          onCancel={cancel}
        />
      )}
    </div>
  );
}
