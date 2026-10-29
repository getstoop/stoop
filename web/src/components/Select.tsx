import type { ComponentProps, ReactNode } from "react";
import { ChevronIcon } from "./Icons";

// A native select with the kit's chevron in place of the browser's arrow,
// so it sits in from the border and takes the theme. The class goes on the
// wrapper, which is what a layout sizes; every other prop goes to the
// select. `icon` puts a glyph inside the left padding (the voice bar's
// device rows); `trailing` puts something inside the right padding,
// before the chevron (the mic row's level meter). The select's padding
// has to make the room for it, since only the caller knows its width.
export function Select({
  className,
  icon,
  trailing,
  ...rest
}: ComponentProps<"select"> & { icon?: ReactNode; trailing?: ReactNode }) {
  return (
    <span className={`select ${className ?? ""}`.trim()}>
      {icon && <span className="select-icon">{icon}</span>}
      <select {...rest} />
      {trailing && <span className="select-trailing">{trailing}</span>}
      <ChevronIcon />
    </span>
  );
}
