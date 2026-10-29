import type { ComponentProps, ReactNode } from "react";
import { ChevronIcon } from "./Icons";

// A native select with the kit's chevron in place of the browser's arrow,
// so it sits in from the border and takes the theme. The class goes on the
// wrapper, which is what a layout sizes; every other prop goes to the
// select. `icon` puts a glyph inside the left padding (the voice bar's
// device rows).
export function Select({
  className,
  icon,
  ...rest
}: ComponentProps<"select"> & { icon?: ReactNode }) {
  return (
    <span className={`select ${className ?? ""}`.trim()}>
      {icon && <span className="select-icon">{icon}</span>}
      <select {...rest} />
      <ChevronIcon />
    </span>
  );
}
