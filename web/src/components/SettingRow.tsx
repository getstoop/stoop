import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import {
  type ControlAttrs,
  controlAttrs,
  errorId,
  type FieldControl,
  fieldControl,
  hintId,
} from "./fieldControl";

// One setting as one row of a settings group: what it is and what it
// does on the left, the control on the right. Pass the control's id and
// the title becomes its label; `heading` makes it a subheading for a row
// that holds several controls, which `stack` lays out top to bottom.
// `error` is a refusal about this row's control, drawn under it; the control
// is wired to it and to the description when it is a child carrying `id`,
// or when the child is a function, which receives the wiring.
// The two columns exist inside the settings frame; anywhere else (the
// setup wizard) and below the phone breakpoint the row is one column.
export function SettingRow({
  id,
  title,
  heading,
  stack,
  description,
  error,
  className,
  children,
  ...rest
}: {
  id?: string;
  title: string;
  heading?: boolean;
  stack?: boolean;
  description?: ReactNode;
  error?: string | null;
  className?: string;
  children?: ReactNode | ((control: FieldControl) => ReactNode);
  [data: `data-${string}`]: string | undefined;
}) {
  const control = fieldControl(id ?? "", {
    error: !!error && !!id,
    hint: !!description && !!id,
  });
  return (
    <div
      className={`setting-row ${stack ? "stack" : ""} ${className ?? ""}`}
      {...rest}
    >
      <div className="setting-text">
        {id ? (
          <label htmlFor={id}>{title}</label>
        ) : heading ? (
          <h4>{title}</h4>
        ) : (
          <strong>{title}</strong>
        )}
        {description && (
          <div className="hint" id={id && hintId(id)}>
            {description}
          </div>
        )}
      </div>
      <div className="setting-control">
        {typeof children === "function"
          ? children(control)
          : Children.map(children, (child) =>
              id &&
              isValidElement<Partial<ControlAttrs>>(child) &&
              child.props.id === id
                ? cloneElement(child, controlAttrs(control))
                : child,
            )}
        {error && (
          <p className="error field-error" id={id && errorId(id)} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
