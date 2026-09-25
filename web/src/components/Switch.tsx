import type { InputHTMLAttributes } from "react";

// An on/off setting: a checkbox with role="switch", drawn by fields.css as
// a track and a knob. It stays a native checkbox, so a label, a Field, a
// SettingRow, a form and the keyboard all work as they do for one, and
// `checked` / `onChange` are the checkbox's own. A choose-many set and a
// one-off choice on a submit stay plain checkboxes.
export function Switch({
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <input
      type="checkbox"
      // biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox exposes its own checked state; ARIA in HTML says not to add aria-checked to one
      role="switch"
      className={`switch ${className ?? ""}`.trim()}
      {...rest}
    />
  );
}
