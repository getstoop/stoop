import type { ReactNode } from "react";

// One setting as one row of a settings group: what it is and what it
// does on the left, the control on the right. Pass the control's id and
// the title becomes its label; `heading` makes it a subheading for a row
// that holds several controls, which `stack` lays out top to bottom.
// The two columns exist inside the settings frame; anywhere else (the
// setup wizard) and below the phone breakpoint the row is one column.
export function SettingRow({
  id,
  title,
  heading,
  stack,
  description,
  className,
  children,
  ...rest
}: {
  id?: string;
  title: string;
  heading?: boolean;
  stack?: boolean;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
  [data: `data-${string}`]: string | undefined;
}) {
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
        {description && <div className="hint">{description}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
