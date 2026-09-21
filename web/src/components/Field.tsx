import { cloneElement, type ReactElement, type ReactNode, useId } from "react";
import {
  type ControlAttrs,
  controlAttrs,
  errorId,
  type FieldControl,
  fieldControl,
  hintId,
} from "./fieldControl";

// Words above a control, with a place for its counter, its error and its
// hint. The child is the control itself (a native one or a kit one), which
// is given its id and descriptions; a function child receives them
// instead, for a control with something outside it.
export function Field({
  label,
  counter,
  hint,
  error,
  children,
}: {
  label: string;
  // Right of the label: a count, and at most a small action beside it.
  counter?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children:
    | ReactElement<Partial<ControlAttrs>>
    | ((control: FieldControl) => ReactNode);
}) {
  const auto = useId();
  const own = typeof children === "function" ? undefined : children.props.id;
  const id = own ?? auto;
  const control = fieldControl(id, { error: !!error, hint: !!hint });
  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
        {counter && (
          <span className="field-counter muted small">{counter}</span>
        )}
      </div>
      {typeof children === "function"
        ? children(control)
        : cloneElement(children, controlAttrs(control))}
      {error && (
        <p className="error field-error" id={errorId(id)} role="alert">
          {error}
        </p>
      )}
      {hint && (
        <p className="hint" id={hintId(id)}>
          {hint}
        </p>
      )}
    </div>
  );
}
