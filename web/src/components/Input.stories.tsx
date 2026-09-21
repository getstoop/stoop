import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./Field";
import { SearchIcon } from "./Icons";
import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "Components/Input",
  component: Input,
  decorators: [
    (Story) => (
      <div className="card">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Input>;

export const StartIcon: Story = {
  args: { start: <SearchIcon />, placeholder: "Search people" },
};

export const EndUnit: Story = {
  args: { end: "days", defaultValue: "30", inputMode: "numeric" },
};

export const EndButton: Story = {
  args: {
    type: "search",
    defaultValue: "deploy",
    end: (
      <button type="button" className="icon-button" aria-label="Clear">
        ×
      </button>
    ),
  },
};

export const InAFieldRefused: StoryObj = {
  render: () => (
    <Field
      label="Payload URL"
      error="that address is not allowed by this server's egress policy"
    >
      <Input
        start={<SearchIcon />}
        end="POST"
        defaultValue="http://10.0.0.5/hook"
      />
    </Field>
  ),
};

export const Disabled: Story = {
  args: { start: <SearchIcon />, defaultValue: "casey", disabled: true },
};
