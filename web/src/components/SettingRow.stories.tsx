import type { Meta, StoryObj } from "@storybook/react-vite";
import { NumberInput } from "./NumberInput";
import { SettingRow } from "./SettingRow";

const meta: Meta<typeof SettingRow> = {
  title: "Components/SettingRow",
  component: SettingRow,
  decorators: [
    (Story) => (
      <div className="settings-content">
        <div className="card">
          <Story />
        </div>
      </div>
    ),
  ],
};
export default meta;

export const Plain: StoryObj = {
  render: () => (
    <SettingRow
      id="row-url"
      title="Public address"
      description="Where people reach this server from outside."
    >
      <input id="row-url" defaultValue="https://chat.example.com" />
    </SettingRow>
  ),
};

// The error sits under the control; the description is the hint.
export const Refused: StoryObj = {
  render: () => (
    <SettingRow
      id="row-proxies"
      title="Trusted proxies"
      description="Addresses allowed to set the forwarded-for header."
      error={'"192.168.1" is not an IP address or CIDR range'}
    >
      <input id="row-proxies" defaultValue="10.0.0.0/8, 192.168.1" />
    </SettingRow>
  ),
};

export const RefusedNumber: StoryObj = {
  render: () => (
    <SettingRow
      id="row-cap"
      title="Maximum size per file"
      description="Larger uploads are refused."
      error="the size per file is more than the storage limit of 2048 MB"
    >
      <NumberInput id="row-cap" unit="MB" min={1} defaultValue={4096} />
    </SettingRow>
  ),
};
