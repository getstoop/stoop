// Where the popover sits: beside a rail pill, under a header pill, and
// never past the edge of the window.

export const POPOVER_WIDTH = 280;
const GAP = 8;

export type Placement = "rail" | "header";

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export function popoverPosition(
  anchor: Rect,
  placement: Placement,
  viewportWidth: number,
): { top: number; left: number } {
  const raw =
    placement === "rail"
      ? { top: anchor.top, left: anchor.right + GAP }
      : { top: anchor.bottom + GAP, left: anchor.left };
  const maxLeft = Math.max(GAP, viewportWidth - POPOVER_WIDTH - GAP);
  return { top: raw.top, left: Math.min(Math.max(raw.left, GAP), maxLeft) };
}
