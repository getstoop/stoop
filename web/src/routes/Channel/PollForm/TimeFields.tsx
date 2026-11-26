import { useEffect, useId, useState } from "react";
import { DateTimeField } from "../../../components/DateTimeField";
import { CloseIcon, GlobeIcon, PlusIcon } from "../../../components/Icons";
import { zoneLabel } from "../../../core/dates";
import {
  addSlot,
  canAddSlot,
  canRemoveSlot,
  removeSlot,
  type SlotProblem,
  slotBounds,
  slotCount,
  slotProblemText,
  TIME_SLOTS_FULL,
  type TimePollForm,
  withSlot,
} from "../../../core/timePollForm";

// The times: a DateTimeField each, bounded by day to today through a year
// ahead, a remove button beside it, Add time under them, between two and
// ten. Rows stay in the order they were added; the server sorts them. A
// new row, or the neighbour of one removed, takes focus. Under the list,
// the zone the times are read in.
export function TimeFields({
  form,
  now,
  problems,
  locked,
  focusFirst,
  onChange,
}: {
  form: TimePollForm;
  now: Date;
  problems: Record<number, SlotProblem>;
  // While the poll is being posted: nothing changes.
  locked?: boolean;
  // The form opened with its question filled: start on the first time.
  focusFirst?: boolean;
  onChange: (form: TimePollForm) => void;
}) {
  const baseId = useId();
  const fieldId = (key: number) => `${baseId}-${key}`;
  const [focusNext, setFocusNext] = useState<number | null>(
    focusFirst ? (form.slots[0]?.key ?? null) : null,
  );
  useEffect(() => {
    if (focusNext === null) return;
    document.getElementById(fieldId(focusNext))?.focus();
    setFocusNext(null);
  });

  const { slots } = form;
  const bounds = slotBounds(now);
  const zone = zoneLabel(now);
  const add = () => {
    if (!canAddSlot(form)) return;
    setFocusNext(form.nextKey);
    onChange(addSlot(form));
  };
  // Removing a row moves focus to the one that takes its place, or to the
  // one above when it was the last.
  const remove = (index: number) => {
    if (!canRemoveSlot(form)) return;
    const neighbour = slots[index + 1] ?? slots[index - 1];
    if (neighbour) setFocusNext(neighbour.key);
    onChange(removeSlot(form, slots[index].key));
  };

  return (
    <fieldset className="poll-form-group">
      {/* The count is in the legend, so it is part of the group's name. */}
      <legend className="poll-form-legend">
        <span>Times</span>
        <span className="field-counter muted small">{slotCount(form)}</span>
      </legend>
      {slots.map((slot, index) => {
        const problem = problems[slot.key];
        const errorId = `${fieldId(slot.key)}-error`;
        return (
          <div key={slot.key} className="poll-option-field">
            <div className="poll-option-line">
              <DateTimeField
                id={fieldId(slot.key)}
                aria-label={`Time ${index + 1}`}
                value={slot.value}
                min={bounds.min}
                max={bounds.max}
                readOnly={locked}
                note={`In your time zone: ${zone}`}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? errorId : undefined}
                onChange={(value) => onChange(withSlot(form, slot.key, value))}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove time ${index + 1}`}
                title="Remove time"
                disabled={locked || !canRemoveSlot(form)}
                onClick={() => remove(index)}
              >
                <CloseIcon />
              </button>
            </div>
            {problem && (
              <p className="error field-error" id={errorId} role="alert">
                {slotProblemText(problem)}
              </p>
            )}
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className="chip poll-add-option"
          disabled={locked || !canAddSlot(form)}
          onClick={add}
        >
          <PlusIcon />
          Add time
        </button>
      </div>
      {!canAddSlot(form) && <p className="hint">{TIME_SLOTS_FULL}</p>}
      <p className="hint time-poll-zone">
        <GlobeIcon />
        <span>
          Times are in your time zone: {zone}. Everyone sees them in their own.
        </span>
      </p>
    </fieldset>
  );
}
