import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { composingKey } from "../dialogKeys";
import {
  boundsOf,
  clampDay,
  type Day,
  dayKey,
  joinValue,
  parseDay,
  parseTypedTime,
  splitValue,
  timeLabel,
  todayOf,
} from "./calendar";
import { MonthGrid } from "./MonthGrid";
import { panelPosition } from "./position";
import { TimeColumn } from "./TimeColumn";

// The open panel: the month on the left, the time on the right, Done at
// the foot. It holds the day and time being chosen and sends the value
// each time both are set; a typed time is taken when it is settled (Enter,
// leaving the field, Done, a press outside), and one that is not a time
// is dropped, so the value keeps the last time taken. It is a dialog of
// its own: while it is open, wherever focus is, Tab goes round its stops
// (the month arrows, the day under focus, the time, Done) and never out,
// and Escape closes it without reaching a dialog it sits in.
export function Panel({
  id,
  value,
  min,
  max,
  anchor,
  note,
  onChange,
  onDone,
  onCancel,
}: {
  id: string;
  value: string;
  min?: string;
  max?: string;
  anchor: DOMRect;
  note?: string;
  onChange: (value: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const bounds = useMemo(() => boundsOf(min, max), [min, max]);
  const [today] = useState(() => todayOf(new Date()));
  const [start] = useState(() => splitValue(value));
  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(start.time);
  const [text, setText] = useState(start.time ? timeLabel(start.time) : "");
  const [error, setError] = useState(false);
  // The day under keyboard focus; the grid shows its month.
  const [focus, setFocus] = useState<Day>(() =>
    clampDay((start.day && parseDay(start.day)) || today, bounds),
  );
  const timeInput = useRef<HTMLInputElement>(null);

  const send = (nextDay: string | null, nextTime: string | null) => {
    if (nextDay && nextTime) onChange(joinValue(nextDay, nextTime));
  };
  const chooseDay = (chosen: Day, toTime: boolean) => {
    setDay(dayKey(chosen));
    setFocus(chosen);
    send(dayKey(chosen), time);
    if (toTime) timeInput.current?.focus();
  };
  const chooseTime = (chosen: string, writeText = true) => {
    setTime(chosen);
    if (writeText) setText(timeLabel(chosen));
    setError(false);
    send(day, chosen);
  };
  // The time the field's words name, or null when they name none.
  const typed = time && text === timeLabel(time) ? time : parseTypedTime(text);
  const complete = !!day && !!typed;

  const onTyped = (next: string) => {
    setText(next);
    setError(false);
  };
  // Set once the panel is on its way out, so that the time field losing
  // focus as it goes neither takes a typed time after Escape put the old
  // value back nor sends one a second time after Done.
  const closing = useRef(false);
  // Takes a typed time that is one; says so when it is not.
  const settle = () => {
    if (closing.current) return false;
    if (typed) {
      if (typed !== time || text !== timeLabel(typed)) chooseTime(typed);
      return true;
    }
    if (text.trim() !== "") setError(true);
    return false;
  };
  // Enter in the time takes it, and closes the panel when a day is
  // chosen too; it never reaches the form round the field.
  const onTimeEnter = () => {
    if (settle() && day) close(onDone);
  };
  const done = () => {
    if (settle()) close(onDone);
  };
  const close = (how: () => void) => {
    closing.current = true;
    how();
  };

  // Escape and Tab are taken at the window before anything else hears
  // them, so they work wherever focus is (a click on the panel's padding,
  // or a browser that does not focus a clicked button), and a Modal round
  // the panel never closes, nor a form's own Tab trap moves focus behind
  // it. A press outside settles the typed time before the field closes
  // the panel.
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onCancel, settle, close });
  latest.current = { onCancel, settle, close };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tab =
        event.key === "Tab" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey;
      if (event.key !== "Escape" && !tab) return;
      // Nothing round the panel hears it either way.
      event.stopPropagation();
      // An input method's own Escape or Tab: it is the IME's to handle.
      if (composingKey(event)) return;
      event.preventDefault();
      if (event.key === "Escape") latest.current.close(latest.current.onCancel);
      else if (panel.current) cycle(panel.current, event.shiftKey);
    };
    // A press outside settles the typed time first: one that closes the
    // panel (a click on the field or the page) sends it once, since the
    // panel draws again before the field's blur finds nothing to change;
    // one that does not (a right-click on the field) leaves it open.
    const onPress = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      latest.current.settle();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPress, true);
    };
  }, []);

  // Placed after each render, before it is painted: the panel's height
  // is known only once it is drawn. It is never hidden meanwhile, since
  // the day under focus takes the page's focus as it mounts.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    const next = panelPosition(
      anchor,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (next.top !== at?.top || next.left !== at?.left) setAt(next);
  });

  const errorId = `${id}-error`;
  return (
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-modal="true"
      aria-label="Pick a date and time"
      // A click on the panel's own ground keeps focus in it.
      tabIndex={-1}
      className="date-time-panel popover"
      style={at ?? { top: 0, left: 0 }}
    >
      <div className="date-time-panel-body">
        <MonthGrid
          focus={focus}
          chosen={day}
          today={today}
          bounds={bounds}
          onMove={setFocus}
          onChoose={chooseDay}
        />
        <TimeColumn
          inputRef={timeInput}
          time={time}
          text={text}
          invalid={error}
          errorId={errorId}
          onText={onTyped}
          stepFrom={typed ?? time}
          onPick={chooseTime}
          onEnter={onTimeEnter}
          onBlur={settle}
        />
      </div>
      {error && (
        <p className="error date-time-panel-error" id={errorId} role="alert">
          That isn't a time. Try {timeLabel("19:30")}
          {timeLabel("19:30") === "19:30" ? "" : " or 19:30"}.
        </p>
      )}
      <div className="date-time-panel-foot">
        <span className="hint">{note}</span>
        <button
          type="button"
          className="primary"
          disabled={!complete}
          onClick={done}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// Tab and Shift+Tab round the panel's own stops: what is enabled and not
// taken out of the order (the days other than the one under focus).
function cycle(panel: HTMLElement, back: boolean) {
  const stops = Array.from(
    panel.querySelectorAll<HTMLElement>(
      "input:not(:disabled), button:not(:disabled):not([tabindex='-1'])",
    ),
  );
  if (stops.length === 0) return;
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const next = back
    ? at <= 0
      ? stops.length - 1
      : at - 1
    : at < 0 || at === stops.length - 1
      ? 0
      : at + 1;
  stops[next].focus();
}
