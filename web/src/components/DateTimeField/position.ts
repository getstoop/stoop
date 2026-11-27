// Where the panel goes, fixed to the viewport so a dialog's clipping
// can't cut it: under the field, above it when the window's bottom is too
// close, and pushed on screen when neither fits. Kept 8px from every edge.

const GAP = 4;
const EDGE = 8;

export type Rect = Pick<DOMRect, "top" | "bottom" | "left">;

export function panelPosition(
  field: Rect,
  panel: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number } {
  const left = Math.max(
    EDGE,
    Math.min(field.left, view.width - panel.width - EDGE),
  );
  const below = field.bottom + GAP;
  if (below + panel.height <= view.height - EDGE) return { top: below, left };
  const above = field.top - GAP - panel.height;
  if (above >= EDGE) return { top: above, left };
  return { top: Math.max(EDGE, view.height - panel.height - EDGE), left };
}
