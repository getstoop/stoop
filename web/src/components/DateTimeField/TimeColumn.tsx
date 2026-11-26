import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { composing } from "../dialogKeys";
import { CheckIcon } from "../Icons";
import { HALF_HOURS, stepTime, timeLabel } from "./calendar";

// The time: a field to type any minute into, over a list of every half
// hour. The field is a combobox for the list: Up and Down step it by half
// hours, and the list is for the pointer, out of the Tab order.
export function TimeColumn({
  inputRef,
  time,
  text,
  invalid,
  errorId,
  onText,
  onPick,
  onEnter,
  onBlur,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  time: string | null;
  text: string;
  invalid: boolean;
  errorId: string;
  onText: (text: string) => void;
  onPick: (time: string) => void;
  onEnter: () => void;
  onBlur: () => void;
}) {
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const optionId = (value: string) => `${listId}-${value.replace(":", "")}`;
  const onList = time !== null && HALF_HOURS.includes(time);

  // The chosen row, or 9:00 when there is none, a few rows down from the
  // top of the list, so the times either side of it show.
  const first = useRef(true);
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>(
      `[data-time="${time && onList ? time : "09:00"}"]`,
    );
    if (!box || !row) return;
    if (first.current) {
      first.current = false;
      box.scrollTop = row.offsetTop - 3 * row.offsetHeight;
    } else row.scrollIntoView({ block: "nearest" });
  }, [time, onList]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      onPick(stepTime(time, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && !composing(event)) {
      // Never the form's submit.
      event.preventDefault();
      onEnter();
    }
  };

  return (
    <div className="date-time-time">
      <span className="date-time-time-label" aria-hidden="true">
        Time
      </span>
      <input
        ref={inputRef}
        name="time"
        role="combobox"
        aria-label="Time"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="none"
        aria-activedescendant={onList && time ? optionId(time) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        autoComplete="off"
        placeholder="Time"
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Times"
        className="date-time-times"
      >
        {HALF_HOURS.map((value) => (
          <div
            key={value}
            id={optionId(value)}
            role="option"
            tabIndex={-1}
            aria-selected={value === time}
            data-time={value}
            className={`option date-time-option${value === time ? " chosen" : ""}`}
            onMouseDown={(event) => {
              // The focus stays where it was.
              event.preventDefault();
              onPick(value);
            }}
          >
            <span>{timeLabel(value)}</span>
            {value === time && <CheckIcon />}
          </div>
        ))}
      </div>
    </div>
  );
}
