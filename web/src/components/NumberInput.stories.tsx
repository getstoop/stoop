import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Field } from "./Field";
import { NumberInput } from "./NumberInput";

const meta: Meta<typeof NumberInput> = {
  title: "Components/NumberInput",
  component: NumberInput,
  decorators: [
    (Story) => (
      <div className="card">
        <Story />
      </div>
    ),
  ],
};
export default meta;

export const Plain: StoryObj<typeof NumberInput> = {
  args: { defaultValue: 3, min: 1 },
};

// Controlled: the stepper reaches onChange like typing does.
function SizePerFile() {
  const [mb, setMb] = useState("512");
  return (
    <Field label="Maximum size per file" hint={`The form holds "${mb}".`}>
      <NumberInput
        unit="MB"
        min={1}
        max={2048}
        value={mb}
        onChange={(e) => setMb(e.target.value)}
      />
    </Field>
  );
}

export const WithUnit: StoryObj = { render: () => <SizePerFile /> };

export const EmptyWithPlaceholder: StoryObj = {
  render: () => (
    <Field label="Delete messages after">
      <NumberInput unit="days" min={1} max={3650} placeholder="Forever" />
    </Field>
  ),
};

export const Refused: StoryObj = {
  render: () => (
    <Field
      label="Maximum size per file"
      error="the size per file is more than the storage limit of 2048 MB"
    >
      <NumberInput unit="MB" min={1} defaultValue={4096} />
    </Field>
  ),
};
