import { type KeyboardEvent, type PointerEvent, useState } from "react";

// The side panel's width, dragged at its left edge and kept per browser.
// The default is the stylesheet's (--side-panel-w, 380px) and is also
// the floor: the panel never goes narrower than it was before it could
// be dragged. The ceiling leaves the page beside it room to read; the
// stylesheet holds both live too, so a window that shrinks with a wide
// panel open brings the panel down with it. Double-click, or Home on
// the handle, goes back to the default.

export const SIDE_PANEL_WIDTH_KEY = "stoop.sidePanelWidth";
export const MIN_SIDE_PANEL = 380;
// What the rail, sidebar and a readable page need between them; the
// same 640px as side-panel.css.
const PAGE_ROOM = 640;
// One arrow key press.
const STEP = 24;

// The widest the panel may be in a window this wide; never under the
// floor, so a small window still shows the default.
export function maxSidePanel(windowWidth: number): number {
  return Math.max(MIN_SIDE_PANEL, windowWidth - PAGE_ROOM);
}

// A saved or dragged width within the floor and the ceiling; anything
// that is not a number reads as unset (the default).
export function clampSidePanel(raw: unknown, max: number): number | null {
  const n = typeof raw === "string" ? Number(raw.trim() || "x") : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(Math.max(MIN_SIDE_PANEL, Math.round(n)), max);
}

function load(): number | null {
  try {
    return clampSidePanel(
      localStorage.getItem(SIDE_PANEL_WIDTH_KEY),
      maxSidePanel(window.innerWidth),
    );
  } catch {
    return null;
  }
}

function save(width: number | null) {
  try {
    if (width === null) localStorage.removeItem(SIDE_PANEL_WIDTH_KEY);
    else localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(width));
  } catch {
    // fine
  }
}

export function useSidePanelResize(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number | null>(load);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    const max = maxSidePanel(window.innerWidth);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let last: number | null = null;
    const move = (ev: globalThis.PointerEvent) => {
      // The handle is the left edge: dragging left widens.
      last = clampSidePanel(startW - (ev.clientX - startX), max);
      setWidth(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (last !== null) save(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const reset = () => {
    setWidth(null);
    save(null);
  };

  // Keyboard: Left widens, Right narrows, Home resets.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    if (e.key === "Home") {
      e.preventDefault();
      reset();
      return;
    }
    const step =
      e.key === "ArrowLeft" ? STEP : e.key === "ArrowRight" ? -STEP : 0;
    if (!step) return;
    e.preventDefault();
    const next = clampSidePanel(
      el.getBoundingClientRect().width + step,
      maxSidePanel(window.innerWidth),
    );
    setWidth(next);
    save(next);
  };

  return { width, onPointerDown, onKeyDown, reset };
}
