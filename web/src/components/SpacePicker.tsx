import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { Space } from "../gen/stoop/chat/v1/space_pb";

const LIST_MAX_HEIGHT = 240;

// Under the search field, or above it when the window's bottom is close.
// Fixed to the viewport, like the ⋮ menu, so the modal's scroll can't
// clip it.
function listPosition(anchor: DOMRect): CSSProperties {
  const left = anchor.left;
  const width = anchor.width;
  if (anchor.bottom + 4 + LIST_MAX_HEIGHT > window.innerHeight - 8) {
    return { bottom: window.innerHeight - anchor.top + 4, left, width };
  }
  return { top: anchor.bottom + 4, left, width };
}

// A bot's spaces: type to find one in the dropdown, pick it, and it joins
// the pills underneath.
export function SpacePicker({
  spaces,
  selected,
  onChange,
}: {
  spaces: Space[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const q = query.trim().toLowerCase();
  const matches = spaces.filter(
    (s) => !selected.includes(s.id) && s.name.toLowerCase().includes(q),
  );
  const current = Math.min(active, matches.length - 1);
  const picked = selected
    .map((id) => spaces.find((s) => s.id === id))
    .filter((s): s is Space => s !== undefined);

  useEffect(() => {
    if (!open) return;
    const place = () =>
      setAnchor(inputRef.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const pick = (s: Space) => {
    onChange([...selected, s.id]);
    setQuery("");
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(Math.min(current + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter" && open && matches[current]) {
      e.preventDefault();
      pick(matches[current]);
    } else if (e.key === "Escape" && open) {
      // Close the list, not the modal.
      e.stopPropagation();
      setOpen(false);
    }
  };

  if (spaces.length === 0) {
    return <p className="hint">You're not in any spaces yet.</p>;
  }

  return (
    <div className="space-picker">
      <input
        ref={inputRef}
        type="search"
        name="token-space-search"
        role="combobox"
        aria-label="Search spaces"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && current >= 0 ? `${listId}-${current}` : undefined
        }
        autoComplete="off"
        placeholder="Search spaces"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && anchor && (
        <div
          id={listId}
          role="listbox"
          aria-label="Spaces"
          className="space-picker-options"
          style={listPosition(anchor)}
        >
          {matches.length === 0 && (
            <div className="space-picker-empty">
              {picked.length === spaces.length
                ? "Every space is already picked."
                : "No space matches that."}
            </div>
          )}
          {matches.map((s, i) => (
            <div
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === current}
              className={i === current ? "active" : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep the field focused
                pick(s);
              }}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
      {picked.length > 0 && (
        <div className="space-picker-pills">
          {picked.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              aria-label={`Remove ${s.name}`}
              onClick={() => onChange(selected.filter((id) => id !== s.id))}
            >
              {s.name}
              <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
