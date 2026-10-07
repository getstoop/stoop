import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { BackIcon, CloseIcon } from "../Icons";
import { useCloseSidePanel } from "./context";

interface Props {
  title: ReactNode;
  // Where the content came from ("#garden"), so it is never taken for the
  // page beside it.
  subtitle?: ReactNode;
  // Below the body and outside its scroll: a thread's message box.
  footer?: ReactNode;
  children: ReactNode;
}

// The panel's frame, which every kind of content draws itself in: a
// header with its title and a Close (Back on a narrow screen, by CSS), a
// scrolling body and an optional footer. Focus moves to the title when it
// appears, and Escape closes it while focus is inside.
export function SidePanelFrame({ title, subtitle, footer, children }: Props) {
  const close = useCloseSidePanel();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  };

  return (
    <aside
      className="side-panel"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
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
