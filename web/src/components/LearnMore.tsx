import type { ReactNode } from "react";

export function LearnMore({
  label = "Learn more",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details className="learn-more">
      <summary>{label}</summary>
      <div className="learn-more-body">{children}</div>
    </details>
  );
}
