import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./Field";
import { Select } from "./Select";
import { MicIcon } from "./VoiceIcons";

const meta: Meta<typeof Select> = {
  title: "Components/Select",
  component: Select,
  decorators: [
    (Story) => (
      <div className="card">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Select>;

const options = (
  <>
    <option value="invite">Invite only</option>
    <option value="open">Anyone with the link</option>
    <option value="closed">Closed</option>
  </>
);

export const Default: Story = {
  args: { defaultValue: "invite", "aria-label": "Sign-up", children: options },
};

export const Disabled: Story = {
  args: { ...Default.args, disabled: true },
};

export const InAFieldRefused: StoryObj = {
  render: () => (
    <Field label="Sign-up" error="pick one of the listed choices">
      <Select defaultValue="invite">{options}</Select>
    </Field>
  ),
};

export const WithAnIcon: Story = {
  args: { ...Default.args, icon: <MicIcon /> },
};

export const WithATrailingSlot: Story = {
  args: {
    ...Default.args,
    trailing: <span className="small muted">3 of 5</span>,
  },
};
