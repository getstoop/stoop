import type { ComponentProps } from "react";
import { ChevronIcon } from "./Icons";

// A native select with the kit's chevron in place of the browser's arrow,
// so it sits in from the border and takes the theme. The class goes on the
// wrapper, which is what a layout sizes; every other prop goes to the
// select.
export function Select({ className, ...rest }: ComponentProps<"select">) {
  return (
    <span className={`select ${className ?? ""}`.trim()}>
      <select {...rest} />
      <ChevronIcon />
    </span>
  );
}
