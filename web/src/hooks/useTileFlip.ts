import { useLayoutEffect, useRef } from "react";

// FLIP for the voice stage's tile grid. The layout still snaps to its
// final size in one step — adaptiveStream sees exactly one resize per
// join, as it did before — and each tile is then animated back from
// where it was, with a transform the compositor owns. Every tile is
// 16:9, so the scale is uniform and nothing distorts.
//
// A change in *who* is on stage animates, and so does a change of
// arrangement — the grid giving way to the spotlight's carousel, and
// back. A window resize, a drag of the stage/chat divider and entering
// fullscreen move tiles too, but for reasons the eye can already see,
// so those runs just refresh the cache.

type Rect = { x: number; y: number; w: number };

const FLIP = "tile-flip";

export function useTileFlip(
  ref: React.RefObject<HTMLElement | null>,
  keys: string,
  mode: string,
  tileWidth: number | null,
) {
  const rects = useRef(new Map<string, Rect>());
  const prevKeys = useRef(keys);
  const prevMode = useRef(mode);

  // tileWidth is a re-run signal rather than a value the effect reads:
  // it changes whenever the strip is resized or the divider dragged,
  // and re-running then is what keeps the cached rects describing the
  // layout that is actually on screen. Without it they go stale after a
  // drag and the next join glides in from where the tile used to be.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tileWidth is a re-run signal, not read here
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Either signal is enough. Both ways into the spotlight are covered
    // that way: pinning a tile changes who is in the grid, while a share
    // starting changes only the arrangement, and both should glide.
    const moved = prevKeys.current !== keys || prevMode.current !== mode;
    prevKeys.current = keys;
    prevMode.current = mode;

    const style = getComputedStyle(el);
    const ms = milliseconds(style.getPropertyValue("--dur"));
    const easing = style.getPropertyValue("--ease").trim() || "ease";
    const next = new Map<string, Rect>();

    for (const node of Array.from(el.children) as HTMLElement[]) {
      const key = node.dataset.tileKey;
      if (!key) continue;

      // A tile still in flight from the last join: its live rect is
      // where the eye currently sees it, and that is what the next
      // animation should start from. Read it before cancelling, and
      // the two chain instead of snapping.
      const running = node.getAnimations().filter((a) => a.id === FLIP);
      const from = running.length ? measure(node) : rects.current.get(key);
      for (const a of running) a.cancel();

      const to = measure(node);
      next.set(key, to);
      if (!moved || !ms) continue;

      // No cached rect: this tile is new, and arrives in place.
      if (!from) {
        node.animate(
          [
            { opacity: 0, transform: "scale(0.92)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: ms, easing, id: FLIP },
        );
        continue;
      }

      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const scale = to.w ? from.w / to.w : 1;
      if (!dx && !dy && Math.abs(scale - 1) < 0.001) continue;

      node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          { transform: "none" },
        ],
        { duration: ms, easing, id: FLIP },
      );
    }

    rects.current = next;
  }, [ref, keys, mode, tileWidth]);
}

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width };
}

// The stage reads its motion from the same tokens as everything else,
// so reduced motion zeroes --dur and this returns 0 — no animation at
// all, rather than a zero-length one.
function milliseconds(raw: string): number {
  const v = raw.trim();
  const n = Number.parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return v.endsWith("ms") ? n : n * 1000;
}
