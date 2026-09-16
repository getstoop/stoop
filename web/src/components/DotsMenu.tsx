import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { DotsIcon } from "./Icons";

export type MenuItem = {
  label: string;
  // May return a promise; see done.
  onSelect: () => unknown;
  // Shown in place of the label for a moment before the menu closes, once
  // onSelect resolves to anything but false: "Copied!" for an action with
  // nothing else on screen to show it worked.
  done?: string;
  danger?: boolean;
  title?: string;
  // Shown, greyed, and inert: an item that says why it can't be picked.
  disabled?: boolean;
};

const MENU_WIDTH = 180;
const ITEM_HEIGHT = 34;
const DONE_MS = 900;

// Fixed coordinates for the menu: right-aligned under the button, or
// above it when the bottom of the window is too close, and never past
// the window's right edge.
function menuPosition(anchor: DOMRect, items: number): CSSProperties {
  const height = items * ITEM_HEIGHT + 8;
  const left = Math.max(
    8,
    Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
  );
  const below = anchor.bottom + 4;
  const top =
    below + height > window.innerHeight - 8 ? anchor.top - height - 4 : below;
  return { top, left, width: MENU_WIDTH };
}

// A ⋮ button that opens a list of actions (the kit's popover menu; styles
// in surfaces.css). Opened on click, closed by Escape, a click outside, a
// scroll, or picking an item. The menu is fixed to the viewport so a
// scrolling parent can't clip it. Features style the wrapper through
// className — the channel row reveals its button on hover.
export function DotsMenu({
  label,
  items,
  className = "",
}: {
  // Accessible name for the button, e.g. "Options for #general".
  label: string;
  items: MenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // The item showing its done label, while the menu waits to close.
  const [doneLabel, setDoneLabel] = useState<string | null>(null);
  // Where the button was when the menu opened.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!doneLabel) return;
    const id = setTimeout(() => {
      setOpen(false);
      setDoneLabel(null);
    }, DONE_MS);
    return () => clearTimeout(id);
  }, [doneLabel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    // A scroll anywhere would leave the menu floating away from its row.
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    const id = setTimeout(() => window.addEventListener("mousedown", onClick));
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className={`dots-menu-anchor ${open ? "open" : ""} ${className}`}
    >
      <button
        type="button"
        className="icon-button dots-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
          // During a done label the menu is on its way out: a click
          // brings it back fresh rather than finishing the close.
          setOpen((o) => !o || doneLabel !== null);
          setDoneLabel(null);
        }}
      >
        <DotsIcon />
      </button>
      {open && anchor && (
        <div
          className="dots-menu"
          role="menu"
          style={menuPosition(anchor, items.length)}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : undefined}
              title={item.title}
              aria-disabled={item.disabled || undefined}
              onClick={async () => {
                if (item.disabled || doneLabel) return;
                if (!item.done) {
                  setOpen(false);
                  item.onSelect();
                  return;
                }
                if ((await item.onSelect()) === false) setOpen(false);
                else setDoneLabel(item.label);
              }}
            >
              {doneLabel === item.label ? item.done : item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
