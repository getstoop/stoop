import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { CloseIcon, PlusIcon } from "../../../components/Icons";
import {
  addOption,
  canAddOption,
  canRemoveOption,
  moveOption,
  POLL_OPTIONS_FULL,
  type PollFieldProblem,
  type PollForm,
  pollOptionCount,
  pollProblemText,
  removeOption,
  trimPollText,
  withOptionText,
} from "../../../core/pollForm";
import { composing } from "./keys";

// The options: a field each, a remove button beside it, Add option under
// them, between two and ten. The keys suit a list of lines: Enter goes
// to the next field, and from a filled last one adds another; Backspace
// in an empty field removes it; Alt+Arrow moves a field up or down.
export function OptionFields({
  form,
  problems,
  locked,
  onChange,
}: {
  form: PollForm;
  problems: Record<number, PollFieldProblem>;
  // While the poll is being posted: nothing changes.
  locked?: boolean;
  onChange: (form: PollForm) => void;
}) {
  const baseId = useId();
  const inputs = useRef(new Map<number, HTMLInputElement>());
  // The field to focus once it is drawn: a new one, or a neighbour of
  // one removed; end puts the caret at the end of its text.
  const [focusNext, setFocusNext] = useState<{
    key: number;
    end: boolean;
  } | null>(null);
  useEffect(() => {
    if (!focusNext) return;
    const input = inputs.current.get(focusNext.key);
    input?.focus();
    if (input && focusNext.end) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    setFocusNext(null);
  }, [focusNext]);

  const { options } = form;
  const add = () => {
    if (!canAddOption(form)) return;
    setFocusNext({ key: form.nextKey, end: true });
    onChange(addOption(form));
  };
  // Removing a field moves focus to the one that takes its place, or to
  // the one above when it was the last.
  const remove = (index: number) => {
    if (!canRemoveOption(form)) return;
    const neighbour = options[index + 1] ?? options[index - 1];
    if (neighbour) setFocusNext({ key: neighbour.key, end: true });
    onChange(removeOption(form, options[index].key));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const option = options[index];
    if (locked || composing(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      // Cmd or Ctrl with Enter is the form's: it posts.
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      const next = options[index + 1];
      if (next) setFocusNext({ key: next.key, end: true });
      else if (trimPollText(option.text) !== "") add();
      return;
    }
    // A fresh press in a field already empty: a held Backspace that has
    // just emptied it stops there rather than going on into the next.
    if (
      event.key === "Backspace" &&
      !event.repeat &&
      option.text === "" &&
      canRemoveOption(form)
    ) {
      event.preventDefault();
      const above = options[index - 1] ?? options[index + 1];
      if (above) setFocusNext({ key: above.key, end: true });
      onChange(removeOption(form, option.key));
      return;
    }
    if (
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= options.length) return;
      setFocusNext({ key: option.key, end: false });
      onChange(moveOption(form, option.key, to));
    }
  };

  return (
    <fieldset className="poll-form-group">
      {/* The count is in the legend, so it is part of the group's name. */}
      <legend className="poll-form-legend">
        <span>Options</span>
        <span className="field-counter muted small">
          {pollOptionCount(form)}
        </span>
      </legend>
      {options.map((option, index) => {
        const problem = problems[option.key];
        const errorId = `${baseId}-${option.key}-error`;
        return (
          <div key={option.key} className="poll-option-field">
            <div className="poll-option-line">
              <input
                ref={(input) => {
                  if (input) inputs.current.set(option.key, input);
                  else inputs.current.delete(option.key);
                }}
                value={option.text}
                placeholder={`Option ${index + 1}`}
                aria-label={`Option ${index + 1}`}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? errorId : undefined}
                autoComplete="off"
                readOnly={locked}
                onChange={(event) =>
                  onChange(withOptionText(form, option.key, event.target.value))
                }
                onKeyDown={(event) => onKeyDown(event, index)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove option ${index + 1}`}
                title="Remove option"
                disabled={locked || !canRemoveOption(form)}
                onClick={() => remove(index)}
              >
                <CloseIcon />
              </button>
            </div>
            {problem && (
              <p className="error field-error" id={errorId} role="alert">
                {pollProblemText(problem, "option")}
              </p>
            )}
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className="chip poll-add-option"
          disabled={locked || !canAddOption(form)}
          onClick={add}
        >
          <PlusIcon />
          Add option
        </button>
      </div>
      {!canAddOption(form) && <p className="hint">{POLL_OPTIONS_FULL}</p>}
    </fieldset>
  );
}
