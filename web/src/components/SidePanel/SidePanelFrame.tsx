import {
  type AnimationEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { BackIcon, CloseIcon } from "../Icons";
import { useCloseSidePanel, usePanelMotion } from "./context";
import { useSidePanelResize } from "./resize";

interface Props {
  title: ReactNode;
  // Where the content came from ("#garden"), so it is never taken for the
  // page beside it.
  subtitle?: ReactNode;
  // Below the body and outside its scroll: a thread's message box.
  footer?: ReactNode;
  // Buttons in the header, before Close.
  actions?: ReactNode;
  children: ReactNode;
}

// The panel's frame, which every kind of content draws itself in: a
// header with its title and a Close (Back on a narrow screen, by CSS), a
// scrolling body and an optional footer. It slides in, and out once
// closed. Focus moves to the title when it appears, and Escape closes it
// while focus is inside. Its left edge is a handle that sets its width
// (resize.ts); on a phone there is no edge to drag, and mobile.css hides it.
export function SidePanelFrame({
  title,
  subtitle,
  footer,
  actions,
  children,
}: Props) {
  const close = useCloseSidePanel();
  const { entering, leaving, left } = usePanelMotion();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const resize = useSidePanelResize(panel);
  const style = (
    resize.width === null
      ? undefined
      : { "--side-panel-w": `${resize.width}px` }
  ) as CSSProperties | undefined;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const onAnimationEnd = (event: AnimationEvent) => {
    if (leaving && event.target === event.currentTarget) left();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  };

  return (
    <aside
      ref={panel}
      className={`side-panel${leaving ? " leaving" : entering ? "" : " replaced"}`}
      style={style}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onAnimationEnd={onAnimationEnd}
    >
      <button
        type="button"
        className="side-panel-resizer"
        aria-label="Resize the panel (drag, or arrow keys; Home resets)"
        title="Drag to resize · double-click to reset"
        onPointerDown={resize.onPointerDown}
        onKeyDown={resize.onKeyDown}
        onDoubleClick={resize.reset}
      />
      <header className="side-panel-header">
        <button
          type="button"
          className="icon-button side-panel-back"
          aria-label="Back"
          onClick={close}
        >
          <BackIcon />
        </button>
        <h2
          id={titleId}
          className="side-panel-title"
          tabIndex={-1}
          ref={heading}
        >
          {title}
        </h2>
        {subtitle && <span className="side-panel-subtitle">{subtitle}</span>}
        {actions && <span className="side-panel-actions">{actions}</span>}
        <button
          type="button"
          className="icon-button side-panel-close"
          aria-label="Close"
          onClick={close}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="side-panel-body">{children}</div>
      {footer && <div className="side-panel-footer">{footer}</div>}
    </aside>
  );
}
