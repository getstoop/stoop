import {
  cloneElement,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// How long a mouse rests on the anchor before the tooltip appears.
const DELAY = 350;
// Space between the tooltip and both its anchor and the window's edge.
const GAP = 8;

type Side = "top" | "right" | "bottom" | "left";
type Point = { top: number; left: number };

// What Tooltip reads off its child and puts back, chained ahead of
// whatever the child already had.
type AnchorProps = {
  "aria-describedby"?: string;
  onPointerEnter?: (e: PointerEvent<Element>) => void;
  onPointerLeave?: (e: PointerEvent<Element>) => void;
  onPointerDown?: (e: PointerEvent<Element>) => void;
  onFocus?: (e: FocusEvent<Element>) => void;
  onBlur?: (e: FocusEvent<Element>) => void;
};

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(v, Math.max(lo, hi)));

// Fixed coordinates on the asked-for side of the anchor, flipped to the
// opposite side when this one has no room, then clamped inside the window.
function place(anchor: DOMRect, tip: DOMRect, want: Side): Point {
  const room: Record<Side, number> = {
    top: anchor.top,
    bottom: window.innerHeight - anchor.bottom,
    left: anchor.left,
    right: window.innerWidth - anchor.right,
  };
  const depth =
    (want === "top" || want === "bottom" ? tip.height : tip.width) + GAP;
  const side =
    room[want] < depth && room[OPPOSITE[want]] >= depth ? OPPOSITE[want] : want;

  const midY = anchor.top + (anchor.height - tip.height) / 2;
  const midX = anchor.left + (anchor.width - tip.width) / 2;
  let raw: Point;
  switch (side) {
    case "top":
      raw = { top: anchor.top - tip.height - GAP, left: midX };
      break;
    case "bottom":
      raw = { top: anchor.bottom + GAP, left: midX };
      break;
    case "left":
      raw = { top: midY, left: anchor.left - tip.width - GAP };
      break;
    default:
      raw = { top: midY, left: anchor.right + GAP };
  }
  return {
    top: clamp(raw.top, GAP, window.innerHeight - tip.height - GAP),
    left: clamp(raw.left, GAP, window.innerWidth - tip.width - GAP),
  };
}

// A hover/focus tooltip for one control (the kit's; styles in
// surfaces.css). It adds no wrapper: the handlers and aria-describedby go
// on the child, and the panel is a fixed sibling, which is out of flow
// even inside a flex row and can't be clipped by a scrolling parent.
// Opened by a mouse resting on the anchor or by keyboard focus, closed by
// leaving, Escape, a press, a scroll or a resize. Touch never opens one,
// so a phone still gets the control's own label and nothing else.
// An empty `text` renders the child alone: pass an optional value
// straight through rather than branching at the call site.
export function Tooltip({
  text,
  detail,
  side = "top",
  children,
}: {
  text?: string;
  // A second, quieter line under the first — a description under a name.
  detail?: string;
  side?: Side;
  children: ReactElement<AnchorProps>;
}) {
  // Where the anchor was when the tooltip opened; null while closed.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [at, setAt] = useState<Point | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const open = anchor !== null;

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setAnchor(null);
    setAt(null);
  }, []);
  const show = (el: Element, delay: number) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setAnchor(el.getBoundingClientRect()),
      delay,
    );
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // A scroll or resize anywhere would leave it floating away from its
    // anchor, and the rect it was placed from is already stale.
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  // Measured once it has rendered: its size decides the side and the clamp.
  useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    setAt(place(anchor, tipRef.current.getBoundingClientRect(), side));
  }, [anchor, side]);

  if (!text) return children;

  const own = children.props;
  const describedBy = [own["aria-describedby"], open ? id : null]
    .filter(Boolean)
    .join(" ");
  const anchored = cloneElement(children, {
    "aria-describedby": describedBy || undefined,
    onPointerEnter: (e: PointerEvent<Element>) => {
      own.onPointerEnter?.(e);
      if (e.pointerType === "mouse") show(e.currentTarget, DELAY);
    },
    onPointerLeave: (e: PointerEvent<Element>) => {
      own.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e: PointerEvent<Element>) => {
      own.onPointerDown?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<Element>) => {
      own.onFocus?.(e);
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, 0);
    },
    onBlur: (e: FocusEvent<Element>) => {
      own.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {anchored}
      {open && (
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="tooltip"
          // Rendered before it can be measured, so hidden for that frame.
          style={at ?? { visibility: "hidden" }}
        >
          <span>{text}</span>
          {detail && <span className="tooltip-detail">{detail}</span>}
        </div>
      )}
    </>
  );
}
