import type { ReactNode } from "react";

export type ChoiceOption<T extends string> = {
  value: T;
  title: string;
  hint: string;
  // Shown under the option while it is picked.
  body?: ReactNode;
};

// Pick one of a few, each with a line saying what it means. What the
// picked option needs to know opens under it.
export function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T | null;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="setup-choices">
      <legend>{legend}</legend>
      {options.map((o) => (
        <div key={o.value} className="setup-choice-item">
          <label className="setup-choice">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="setup-choice-text">
              <strong>{o.title}</strong>
              <span className="hint">{o.hint}</span>
            </span>
          </label>
          {value === o.value && o.body && (
            <div className="setup-choice-body">{o.body}</div>
          )}
        </div>
      ))}
    </fieldset>
  );
}
