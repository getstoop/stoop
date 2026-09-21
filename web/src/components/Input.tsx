import type { ComponentProps, MouseEvent, ReactNode } from "react";

// A text input with room at its start and its end: an icon, a unit, a
// button. The wrapper is the box, so the focus halo and the danger border
// go round the slots too. Every other prop goes to the input.
export function Input({
  start,
  end,
  className,
  ...rest
}: {
  start?: ReactNode;
  end?: ReactNode;
} & ComponentProps<"input">) {
  // A click on a slot's icon or unit lands in the input, as it would on
  // a native field's padding.
  const focusInput = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, button")) return;
    e.preventDefault();
    e.currentTarget.querySelector("input")?.focus();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards a click to its input
    <div className={`input ${className ?? ""}`.trim()} onMouseDown={focusInput}>
      {start && <span className="input-slot">{start}</span>}
      <input {...rest} />
      {end && <span className="input-slot">{end}</span>}
    </div>
  );
}
