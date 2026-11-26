import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Field } from "../Field";
import { DateTimeField } from ".";

const meta: Meta<typeof DateTimeField> = {
  title: "Components/DateTimeField",
  component: DateTimeField,
  decorators: [
    (Story) => (
      <div className="card">
        <Story />
      </div>
    ),
  ],
};
export default meta;

const pad = (value: number) => String(value).padStart(2, "0");
const local = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromNow = (days: number, hour = 10, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

// Controlled, inside a Field, with a minute to a year as bounds (by day)
// and the value the form would hold under it.
function Picker({
  initial = "",
  error,
  readOnly,
}: {
  initial?: string;
  error?: string;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const now = new Date();
  const yearOut = new Date(now);
  yearOut.setFullYear(now.getFullYear() + 1);
  return (
    <Field label="When" error={error} hint={`The form holds "${value}".`}>
      <DateTimeField
        value={value}
        onChange={setValue}
        min={local(now)}
        max={local(yearOut)}
        readOnly={readOnly}
        note="From a minute to a year from now."
      />
    </Field>
  );
}

export const Empty: StoryObj = { render: () => <Picker /> };

export const Chosen: StoryObj = {
  render: () => <Picker initial={local(fromNow(16))} />,
};

export const NextYear: StoryObj = {
  render: () => <Picker initial={local(fromNow(300, 19, 45))} />,
};

export const Refused: StoryObj = {
  render: () => (
    <Picker
      initial={local(fromNow(0, 0, 30))}
      error="That time has passed. Pick one at least a minute from now."
    />
  ),
};

export const Locked: StoryObj = {
  render: () => <Picker initial={local(fromNow(16))} readOnly />,
};
