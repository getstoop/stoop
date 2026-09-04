import type { ReactNode } from "react";
import { ChevronIcon } from "../Icons";

// A collapsible run of rows under a caps label with its count.
export function MemberGroup({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <li className="member-group">
      <button
        type="button"
        className={`member-group-heading ${open ? "open" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <ChevronIcon />
        {label} · {count}
      </button>
      {open && <ul className="member-group-rows">{children}</ul>}
    </li>
  );
}
