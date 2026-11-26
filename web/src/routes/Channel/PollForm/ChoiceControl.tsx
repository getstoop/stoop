import { CheckIcon } from "../../../components/Icons";

// "People can choose": one option or several (one time or several on a
// time poll), as two halves of one
// control. Each half is a pressed-or-not button, so Tab reaches both and
// neither is chosen by an arrow key on the way past.
export function ChoiceControl({
  noun,
  multiple,
  disabled,
  onChange,
}: {
  // What the poll's choices are.
  noun: "option" | "time";
  multiple: boolean;
  disabled?: boolean;
  onChange: (multiple: boolean) => void;
}) {
  const half = (several: boolean, label: string) => {
    const on = multiple === several;
    return (
      <button
        type="button"
        className={`poll-choice-half${on ? " on" : ""}`}
        aria-pressed={on}
        disabled={disabled}
        onClick={() => onChange(several)}
      >
        {on && <CheckIcon />}
        {label}
      </button>
    );
  };
  return (
    <fieldset className="poll-form-group">
      <legend className="poll-form-legend">People can choose</legend>
      <div className="poll-choice">
        {half(false, `One ${noun}`)}
        {half(true, `Several ${noun}s`)}
      </div>
    </fieldset>
  );
}
