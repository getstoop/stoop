import type { ReactNode } from "react";

const MARKS = { done: "✓", skipped: "–", left: "→" };

// One line of a setup summary: a mark, then what it says.
export function SummaryRow({
  mark,
  children,
}: {
  mark: keyof typeof MARKS;
  children: ReactNode;
}) {
  return (
    <li>
      <span
        className={mark === "done" ? "setup-mark done" : "setup-mark"}
        aria-hidden="true"
      >
        {MARKS[mark]}
      </span>
      {children}
    </li>
  );
}
