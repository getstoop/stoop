import type { Meta, StoryObj } from "@storybook/react-vite";

// The bare controls fields.css styles. A control with a label is a
// <Field> (Components/Field); these are what goes inside one.
const meta: Meta = {
  title: "Kit/Fields",
  decorators: [
    (Story) => (
      <div className="card">
        <Story />
      </div>
    ),
  ],
};
export default meta;

export const Controls: StoryObj = {
  render: () => (
    <div className="kit-section">
      <input type="text" defaultValue="casey" aria-label="Text" />
      <input
        type="text"
        defaultValue="STP-4X9"
        aria-invalid="true"
        aria-label="Invalid text"
      />
      <input type="text" placeholder="A placeholder" aria-label="Empty" />
      <select defaultValue="invite" aria-label="Select">
        <option value="invite">Invite only</option>
        <option value="open">Anyone with the link</option>
        <option value="closed">Closed</option>
      </select>
      <textarea
        rows={2}
        placeholder="What is this place for?"
        aria-label="Textarea"
      />
      <input type="text" defaultValue="Disabled" disabled aria-label="Off" />
    </div>
  ),
};

// A checkbox beside its words; not a Field.
export const ToggleRow: StoryObj = {
  render: () => (
    <label className="toggle-row">
      <input type="checkbox" defaultChecked />
      <span>Play a sound when I am mentioned</span>
    </label>
  ),
};
