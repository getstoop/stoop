import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "Components/Switch",
  component: Switch,
  decorators: [
    (Story) => (
      <div className="card">
        <Story />
      </div>
    ),
  ],
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="kit-row">
      <Switch aria-label="Off" />
      <Switch aria-label="On" defaultChecked />
      <Switch aria-label="Off, disabled" disabled />
      <Switch aria-label="On, disabled" defaultChecked disabled />
    </div>
  ),
};

// Where it mostly lives: the control column of a settings row.
export const InSettingRow: StoryObj = {
  decorators: [
    (Story) => (
      <div className="settings-content">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <>
      <SettingRow
        id="switch-banners"
        title="Desktop notifications"
        description="A native banner when someone mentions you. Off here means no banners at all."
      >
        <Switch id="switch-banners" defaultChecked />
      </SettingRow>
      <SettingRow
        id="switch-cues"
        title="Voice room sounds"
        description="A soft tone when someone joins or leaves the call you're in."
      >
        <Switch id="switch-cues" defaultChecked />
      </SettingRow>
      <SettingRow
        id="switch-refused"
        title="People can delete their own accounts"
        description="Their messages stay under their name, marked deleted."
        error="the server refused: settings are read-only while a restore runs"
      >
        <Switch id="switch-refused" />
      </SettingRow>
    </>
  ),
};

// Beside its words in a form: a toggle row, with the switch in the box's
// place.
export const InToggleRow: StoryObj = {
  render: () => (
    <div className="kit-section">
      <label className="toggle-row">
        <Switch defaultChecked />
        <span>Run a Cloudflare Tunnel</span>
      </label>
      <label className="toggle-row">
        <Switch />
        <span>May notify everyone</span>
      </label>
    </div>
  ),
};
