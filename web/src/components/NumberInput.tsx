import { type ComponentProps, useRef } from "react";
import { ChevronIcon } from "./Icons";
import { Input } from "./Input";

// A number input with the kit's stepper in place of the browser's
// spinner, which no theme can reach, and an optional unit before it.
export function NumberInput({
  unit,
  ...rest
}: { unit?: string } & Omit<ComponentProps<"input">, "type" | "ref">) {
  const input = useRef<HTMLInputElement>(null);
  // stepUp and stepDown keep to min, max and step. They change the value
  // without an event, so send the one React listens for.
  const step = (up: boolean) => {
    const el = input.current;
    if (!el || el.disabled || el.readOnly) return;
    if (up) el.stepUp();
    else el.stepDown();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };
  return (
    <Input
      {...rest}
      ref={input}
      type="number"
      end={
        <>
          {unit}
          <span className="stepper">
            {/* Out of the tab order: the arrow keys already step. */}
            <button
              type="button"
              tabIndex={-1}
              aria-label="Increase"
              onClick={() => step(true)}
            >
              <ChevronIcon />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Decrease"
              onClick={() => step(false)}
            >
              <ChevronIcon />
            </button>
          </span>
        </>
      }
    />
  );
}
