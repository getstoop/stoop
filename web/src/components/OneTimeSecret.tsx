import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

// A secret Stoop shows once (a token, a hook URL or signing secret, a
// temporary password): the warning, what it is for, and the value with a
// copy icon. Every modal that hands one over uses this, so they read and
// copy the same way.
export function OneTimeSecret({
  value,
  warning = "Copy it now. This is the only time it will be shown.",
  hint,
}: {
  value: string;
  warning?: string;
  // What the secret is for, between the warning and the value.
  hint?: ReactNode;
}) {
  return (
    <>
      <p className="callout warn">{warning}</p>
      {hint && <p className="hint">{hint}</p>}
      <div className="one-time-secret">
        <code data-secret>{value}</code>
        <CopyButton text={value} icon />
      </div>
    </>
  );
}
