import type { ReactNode } from "react";
import { SettingRow } from "../SettingRow";

// A group of the form's fields: a headed settings row on the admin tab,
// just the fields in the setup step.
export function EmailGroup({
  headings,
  title,
  description,
  children,
}: {
  headings: boolean;
  title: string;
  description: string;
  children: ReactNode;
}) {
  if (!headings) return <>{children}</>;
  return (
    <SettingRow
      className="email-group"
      heading
      stack
      title={title}
      description={description}
    >
      {children}
    </SettingRow>
  );
}
