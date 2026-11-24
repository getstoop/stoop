import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { dialogOpen } from "../stores/dialogs";

// A card anchored below the element that opened it (a member's or a
// group's): placed on screen, and closed by Escape or a click outside it.
// A click on `opener` is left to the opener, which toggles the card: were
// it taken as outside, it would close the card and the click reopen it.
export function useAnchoredCard(
  anchor: DOMRect,
  onClose: () => void,
  width = 280,
  opener?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A dialog the card itself raised (Block) sits on top of it: its
    // buttons are outside the card, and dismissing the card under them
    // would take the answer's context away with it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialogOpen()) onClose();
    };
    const onClick = (event: MouseEvent) => {
      if (dialogOpen()) return;
      const target = event.target as Node;
      if (opener?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Deferred so the click that opened the card doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener("mousedown", onClick));
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose, opener]);

  // Below the anchor, clamped to the viewport, and never off the bottom:
  // measured after each render, since a card grows as what it shows loads.
  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - width - 8),
  );
  const [top, setTop] = useState(anchor.bottom + 6);
  useLayoutEffect(() => {
    const height = ref.current?.getBoundingClientRect().height ?? 180;
    setTop(
      Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8)),
    );
  });

  return { ref, style: { left, top, width } };
}
