import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./Field";
import { controlAttrs } from "./fieldControl";

const meta: Meta<typeof Field> = {
  title: "Components/Field",
  component: Field,
  decorators: [
    (Story) => (
      <div className="card">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Field>;

export const Plain: Story = {
  args: {
    label: "Display name",
    children: <input defaultValue="casey" />,
  },
};

export const WithHint: Story = {
  args: {
    label: "Node name",
    hint: "The name this server takes on your tailnet.",
    children: <input defaultValue="stoop" />,
  },
};

export const WithCounter: Story = {
  args: {
    label: "Topic",
    counter: "38 / 250",
    children: (
      <textarea
        rows={2}
        defaultValue="Deploys, outages and the on-call rota."
      />
    ),
  },
};

export const Refused: Story = {
  args: {
    label: "Username",
    error: "username is taken",
    children: <input defaultValue="ada" />,
  },
};

// A refused field keeps its hint: the error sits between it and the control.
export const RefusedWithHint: Story = {
  args: {
    label: "Provider id",
    error: "provider id must be 2-32 of a-z, 0-9, -, _",
    hint: "Part of the callback URL. It cannot change later.",
    children: <input defaultValue="My IdP" />,
  },
};

export const Select: Story = {
  args: {
    label: "Posts into",
    children: (
      <select defaultValue="alerts">
        <option value="alerts">#alerts</option>
        <option value="general">#general</option>
      </select>
    ),
  },
};

// Something outside the control: the function child takes the wiring.
export const WithAButtonBeside: Story = {
  args: {
    label: "Space name",
    error: "space name must be 1-100 characters",
    children: (control) => (
      <div className="card-row">
        <input {...controlAttrs(control)} defaultValue="" />
        <button type="button" className="chip">
          Rename
        </button>
      </div>
    ),
  },
};

export const Pair: StoryObj = {
  render: () => (
    <div className="field-pair">
      <Field label="Name" error="a token's name must be 1-50 characters">
        <input placeholder="e.g. backup script" />
      </Field>
      <Field label="Expires">
        <select defaultValue="90">
          <option value="90">In 90 days</option>
          <option value="0">Never</option>
        </select>
      </Field>
    </div>
  ),
};
