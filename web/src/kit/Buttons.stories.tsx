import type { Meta, StoryObj } from "@storybook/react-vite";
import { GearIcon } from "../components/Icons";

const meta: Meta = { title: "Kit/Buttons" };
export default meta;

export const Primary: StoryObj = {
  render: () => (
    <div className="kit-section">
      <div className="kit-row">
        <button type="button" className="primary">
          Send invite
        </button>
        <button type="button" className="primary danger">
          Delete channel
        </button>
        <button type="button" className="primary" disabled>
          Saving…
        </button>
      </div>
    </div>
  ),
};

export const Chip: StoryObj = {
  render: () => (
    <div className="kit-section">
      <div className="kit-row">
        <button type="button" className="chip">
          Copy link
        </button>
        <button type="button" className="chip danger">
          Leave space
        </button>
        <button type="button" className="chip" disabled>
          Revoked
        </button>
      </div>
    </div>
  ),
};

export const Link: StoryObj = {
  render: () => (
    <div className="kit-section">
      <div className="kit-row">
        <button type="button" className="link">
          Continue in this browser
        </button>
      </div>
    </div>
  ),
};

export const Option: StoryObj = {
  render: () => (
    <div className="kit-section">
      <div className="kit-row">
        <div className="popover kit-menu">
          <button type="button" className="option">
            Mute channel
          </button>
          <button type="button" className="option selected">
            Selected by the keyboard
          </button>
          <button type="button" className="option danger">
            Leave space
          </button>
          <button type="button" className="option" aria-disabled="true">
            Owners can't leave
          </button>
        </div>
      </div>
    </div>
  ),
};

export const IconButton: StoryObj = {
  render: () => (
    <div className="kit-section">
      <div className="kit-row">
        <button type="button" className="icon-button" aria-label="Settings">
          <GearIcon />
        </button>
        <button
          type="button"
          className="icon-button danger"
          aria-label="Remove"
        >
          <GearIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Disabled"
          disabled
        >
          <GearIcon />
        </button>
      </div>
    </div>
  ),
};
