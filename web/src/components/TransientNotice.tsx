import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { Tooltip } from "./Tooltip";

// How often a notice whose time is up asks again whether it is still
// pointed at or focused.
const HELD_CHECK_MS = 500;

// What a transient notice says. A new key starts its time again, so a
// notice that changes its words (after its action) stays its full time.
export type TransientNoticeContent = {
  key: string;
  text: string;
  icon?: ReactNode;
  // One icon button, named by label (its accessible name and tooltip).
  action?: {
    label: string;
    icon: ReactNode;
    // The action is out: the button takes no press and says so.
    busy?: boolean;
    onPress: () => void;
  };
  // How long it stays on its own.
  ms: number;
  // Kept on screen whatever the time, while something it shows is out.
  hold?: boolean;
};

// A short notice over the bottom of a view that goes away on its own
// (docs/architecture/web.md → Transient notices): a line of words and at
// most one action. It stays while the pointer is over it or focus is in
// it. It never takes focus: Tab reaches it from the control before it
// (the caller places it after that control), Escape inside it dismisses
// it, and focus that was in it goes back through returnFocus when it
// goes or loses the control that had it. The region is always there and
// is a polite live region, so each notice is announced as it appears.
export function TransientNotice({
  notice,
  onDismiss,
  returnFocus,
}: {
  notice: TransientNoticeContent | null;
  onDismiss: () => void;
  returnFocus: () => void;
}) {
  const region = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Focus was inside at the last render: if the control that had it is
  // gone now, it goes back rather than to the page.
  const hadFocus = useRef(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const giveBack = useRef(returnFocus);
  giveBack.current = returnFocus;

  const key = notice?.key;
  const hold = !!notice?.hold;
  const ms = notice?.ms ?? 0;
  // Its time up, it goes unless the pointer is on it or focus in it, and
  // then as soon as neither is. Asked of the element when the time comes,
  // not followed by events: the pointer's leaving is not always told when
  // the control under it goes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new key starts the time again
  useEffect(() => {
    if (key === undefined || hold) return;
    let timer = window.setTimeout(function check() {
      const element = box.current;
      if (element?.matches(":hover, :focus-within")) {
        timer = window.setTimeout(check, HELD_CHECK_MS);
        return;
      }
      dismiss.current();
    }, ms);
    return () => window.clearTimeout(timer);
  }, [key, hold, ms]);

  useLayoutEffect(() => {
    const inside = !!region.current?.contains(document.activeElement);
    if (hadFocus.current && !inside) {
      const active = document.activeElement;
      if (!active || active === document.body) giveBack.current();
    }
    hadFocus.current = inside;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    giveBack.current();
    dismiss.current();
  };

  const action = notice?.action;
  return (
    <div ref={region} className="transient-notice-region" role="status">
      {notice && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Escape for the button inside
        <div
          ref={box}
          className="transient-notice popover"
          onKeyDown={onKeyDown}
        >
          {notice.icon && (
            <span className="transient-notice-icon">{notice.icon}</span>
          )}
          <span className="transient-notice-text">{notice.text}</span>
          {action && (
            <Tooltip text={action.label}>
              <button
                type="button"
                className="icon-button transient-notice-action"
                aria-label={action.label}
                aria-disabled={action.busy || undefined}
                aria-busy={action.busy || undefined}
                onClick={() => {
                  if (!action.busy) action.onPress();
                }}
              >
                {action.icon}
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
