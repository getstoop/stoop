import { useId } from "react";
import { futureDay, futureTime } from "../../../core/dates";
import {
  customBounds,
  presetLabel,
  presetTime,
  REMINDER_CUSTOM_HINT,
  REMINDER_PRESETS,
  type ReminderChoice,
  type ReminderForm,
  type ReminderPreset,
} from "../../../core/reminderForm";

// When: a radio group of the four presets, each with the time it lands on
// from now, and "Pick a date and time", which opens the browser's own
// date-and-time field under it, bounded to a minute to a year ahead.
// Nothing is chosen at first. problem (a time the server would refuse,
// or did) is said under the group, tied to the date-and-time field.
export function WhenField({
  form,
  now,
  problem,
  locked,
  onChoice,
  onCustom,
}: {
  form: ReminderForm;
  now: Date;
  problem: string | null;
  locked: boolean;
  onChoice: (choice: ReminderChoice) => void;
  onCustom: (value: string) => void;
}) {
  const name = useId();
  const messageId = useId();
  const bounds = customBounds(now);
  const custom = form.choice === "custom";
  return (
    <fieldset className="reminder-when">
      <legend className="reminder-when-legend">When</legend>
      {REMINDER_PRESETS.map((preset) => (
        <label
          key={preset}
          className={`reminder-when-option${form.choice === preset ? " on" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={preset}
            checked={form.choice === preset}
            disabled={locked}
            onChange={() => onChoice(preset)}
          />
          <span className="reminder-when-label">{presetLabel(preset)}</span>
          <span className="reminder-when-lands">{lands(preset, now)}</span>
        </label>
      ))}
      <label className={`reminder-when-option${custom ? " on" : ""}`}>
        <input
          type="radio"
          name={name}
          value="custom"
          checked={custom}
          disabled={locked}
          onChange={() => onChoice("custom")}
          aria-controls={custom ? `${name}-custom` : undefined}
        />
        <span className="reminder-when-label">Pick a date and time</span>
      </label>
      {custom && (
        <input
          id={`${name}-custom`}
          className="reminder-when-custom"
          type="datetime-local"
          aria-label="Date and time"
          value={form.custom}
          min={bounds.min}
          max={bounds.max}
          readOnly={locked}
          aria-invalid={problem ? true : undefined}
          aria-describedby={messageId}
          onChange={(event) => onCustom(event.target.value)}
        />
      )}
      {problem ? (
        <p className="error field-error" id={messageId} role="alert">
          {problem}
        </p>
      ) : (
        custom && (
          <p className="hint" id={messageId}>
            {REMINDER_CUSTOM_HINT}
          </p>
        )
      )}
    </fieldset>
  );
}

// What a preset row says on its right: the time it lands on, worded as a
// future time ("Today at 4:30 PM"); tomorrow's row names the hour already,
// so it says the day.
function lands(preset: ReminderPreset, now: Date): string {
  const at = presetTime(preset, now);
  const words =
    preset === "tomorrow" ? futureDay(at, now) : futureTime(at, now);
  return words[0].toUpperCase() + words.slice(1);
}
