import type { ComponentProps, ReactNode } from "react";
import { ChevronIcon } from "./Icons";

// A native select with the kit's chevron in place of the browser's arrow,
// so it sits in from the border and takes the theme. The class goes on the
// wrapper, which is what a layout sizes; every other prop goes to the
// select. `icon` puts a glyph inside the left padding (the voice bar's
// device rows); `chevron={false}` leaves the arrow off for a select that
// has nothing to open.
export function Select({
  className,
  icon,
  chevron = true,
  ...rest
}: ComponentProps<"select"> & { icon?: ReactNode; chevron?: boolean }) {
  return (
    <span className={`select ${className ?? ""}`.trim()}>
      {icon && <span className="select-icon">{icon}</span>}
      <select {...rest} />
      {chevron && <ChevronIcon />}
    </span>
  );
}
