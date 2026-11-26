import {
  type KeyboardEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  boundsOf,
  clampDay,
  type Day,
  dayKey,
  joinValue,
  localePeriods,
  parseDay,
  parseTypedTime,
  splitValue,
  timeLabel,
  todayOf,
  uses12Hour,
} from "./calendar";
import { MonthGrid } from "./MonthGrid";
import { panelPosition } from "./position";
import { TimeColumn } from "./TimeColumn";

// The open panel: the month on the left, the time on the right, Done at
// the foot. It holds the day and time being chosen and sends the value
// each time both are set. It is a dialog of its own: Tab goes round its
// stops (the month arrows, the day under focus, the time, Done) and never
// out, and Escape closes it without reaching a dialog it sits in.
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
  const periods = useMemo(() => localePeriods(), []);
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
  const readText = () =>
    time && text === timeLabel(time) ? time : parseTypedTime(text, periods);
  const typed = readText();
  const complete = !!day && !!typed;

  const onTyped = (next: string) => {
    setText(next);
    setError(false);
    const read = parseTypedTime(next, periods);
    if (read) chooseTime(read, false);
  };
  // Enter in the time takes it, and closes the panel when a day is
  // chosen too; it never reaches the form round the field.
  const onTimeEnter = () => {
    if (!typed) {
      setError(true);
      return;
    }
    chooseTime(typed);
    if (day) onDone();
  };
  const onTimeBlur = () => {
    if (text.trim() === "") return;
    if (typed) setText(timeLabel(typed));
    else setError(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      cycle(event.currentTarget, event.shiftKey);
    }
  };

  // Placed after each render, before it is painted: the panel's height
  // is known only once it is drawn. It is never hidden meanwhile, since
  // the day under focus takes the page's focus as it mounts.
  const panel = useRef<HTMLDivElement>(null);
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
      className="date-time-panel popover"
      style={at ?? { top: 0, left: 0 }}
      onKeyDown={onKeyDown}
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
          onPick={chooseTime}
          onEnter={onTimeEnter}
          onBlur={onTimeBlur}
        />
      </div>
      {error && (
        <p className="error date-time-panel-error" id={errorId} role="alert">
          That isn't a time. Try {timeLabel("19:30")}
          {uses12Hour() ? " or 19:30" : ""}.
        </p>
      )}
      <div className="date-time-panel-foot">
        <span className="hint">{note}</span>
        <button
          type="button"
          className="primary"
          disabled={!complete}
          onClick={onDone}
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
