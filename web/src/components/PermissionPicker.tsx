import {
  GROUP_LABELS,
  type TokenGroup,
  type TokenOption,
} from "../api/tokenOptions";

const GROUPS: TokenGroup[] = ["space", "account", "server"];

// A token's permissions as checkboxes, grouped by where they apply. The
// group labels come with the option set, since a bot's read differently
// from a person's.
export function PermissionPicker({
  options,
  groupLabels = GROUP_LABELS,
  selected,
  onChange,
}: {
  options: TokenOption[];
  groupLabels?: Record<TokenGroup, string>;
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const toggle = (key: string) =>
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key],
    );

  return (
    <div className="token-permissions">
      {GROUPS.map((group) => {
        const inGroup = options.filter((o) => o.group === group);
        if (inGroup.length === 0) return null;
        return (
          <fieldset key={group}>
            <legend>{groupLabels[group]}</legend>
            {inGroup.map((o) => (
              <label key={o.key} className="toggle-row">
                <input
                  type="checkbox"
                  name={`token-permission-${o.key}`}
                  checked={selected.includes(o.key)}
                  onChange={() => toggle(o.key)}
                />
                <span>
                  {o.label}
                  {o.hint && <span className="hint">{o.hint}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
