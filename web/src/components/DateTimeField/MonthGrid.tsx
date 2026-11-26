import { type KeyboardEvent, useEffect, useId, useMemo, useRef } from "react";
import { ChevronIcon } from "../Icons";
import {
  addMonths,
  type Bounds,
  canTurn,
  clampDay,
  type Day,
  dayKey,
  dayName,
  inBounds,
  monthGrid,
  monthTitle,
  moveByKey,
  sameDay,
  weekdayNames,
} from "./calendar";

// The month of the day under focus, Sunday first, as a grid: one day is
// in the Tab order at a time, and the keys move it (a day, a week, a
// month, the ends of the week), kept to the bounds. Enter chooses it and
// goes on to the time; Space or a click chooses it.
export function MonthGrid({
  focus,
  chosen,
  today,
  bounds,
  onMove,
  onChoose,
}: {
  focus: Day;
  chosen: string | null;
  today: Day;
  bounds: Bounds;
  onMove: (day: Day) => void;
  onChoose: (day: Day, toTime: boolean) => void;
}) {
  const titleId = useId();
  const grid = useRef<HTMLTableElement>(null);
  const names = useMemo(() => weekdayNames(), []);
  const weeks = monthGrid(focus.year, focus.month);
  const focusKey = dayKey(focus);
  // Whether the day under focus should take the page's focus when it
  // changes: after a key in the grid, or when a month arrow it was on
  // can go no further. On open it takes it too.
  const follow = useRef(true);
  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${focusKey}"]`)
      ?.focus();
  }, [focusKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onChoose(focus, true);
      return;
    }
    const next = moveByKey(focus, event.key, bounds);
    if (!next) return;
    event.preventDefault();
    follow.current = true;
    onMove(next);
  };
  const turn = (step: -1 | 1) => {
    const next = clampDay(addMonths(focus, step), bounds);
    follow.current = !canTurn(next, step, bounds);
    onMove(next);
  };

  return (
    <div className="date-time-month">
      <div className="date-time-month-head">
        <h3 id={titleId} className="date-time-month-title">
          {monthTitle(focus)}
        </h3>
        <button
          type="button"
          className="icon-button date-time-back"
          aria-label="Previous month"
          disabled={!canTurn(focus, -1, bounds)}
          onClick={() => turn(-1)}
        >
          <ChevronIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Next month"
          disabled={!canTurn(focus, 1, bounds)}
          onClick={() => turn(1)}
        >
          <ChevronIcon />
        </button>
      </div>
      <table
        ref={grid}
        className="date-time-grid"
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the date-picker grid pattern, a table the arrow keys move round
        role="grid"
        aria-labelledby={titleId}
        data-month={focusKey.slice(0, 7)}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {names.map((name) => (
              <th key={name.long} scope="col" abbr={name.long}>
                {name.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].key}>
              {week.map(({ key, day }) => {
                if (!day) return <td key={key} />;
                const isChosen = key === chosen;
                const isToday = sameDay(day, today);
                return (
                  <td key={key}>
                    <button
                      type="button"
                      data-day={key}
                      className={`date-time-day${isChosen ? " chosen" : ""}${isToday ? " today" : ""}`}
                      tabIndex={key === focusKey ? 0 : -1}
                      disabled={!inBounds(day, bounds)}
                      aria-label={dayName(day)}
                      aria-pressed={isChosen}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => onChoose(day, false)}
                    >
                      {day.day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
