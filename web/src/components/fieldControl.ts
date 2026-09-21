// What a Field or a SettingRow hands the control inside it, so the label,
// the hint and the error all reach it. See
// docs/architecture/design-system.md → Fields.
export type FieldControl = {
  id: string;
  describedBy?: string;
  invalid?: true;
};

// The DOM's names for a FieldControl, to spread on the control:
// <input {...controlAttrs(c)} />.
export function controlAttrs(c: FieldControl) {
  return {
    id: c.id,
    "aria-describedby": c.describedBy,
    "aria-invalid": c.invalid,
  };
}

export type ControlAttrs = ReturnType<typeof controlAttrs>;

export function fieldControl(
  id: string,
  has: { error: boolean; hint: boolean },
): FieldControl {
  const described = [
    has.error ? errorId(id) : "",
    has.hint ? hintId(id) : "",
  ].filter(Boolean);
  return {
    id,
    describedBy: described.length ? described.join(" ") : undefined,
    invalid: has.error ? true : undefined,
  };
}

export const errorId = (id: string) => `${id}-error`;
export const hintId = (id: string) => `${id}-hint`;
