import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = { title: "Kit/Small parts" };
export default meta;

export const Badge: StoryObj = {
  render: () => (
    <div className="kit-row">
      <span className="badge">Admin</span>
      <span className="badge ok">Connected</span>
      <span className="badge warn">Reconnecting</span>
      <span className="badge danger">Expired</span>
    </div>
  ),
};

// The heading over a group, and the three places that wear it.
export const Eyebrow: StoryObj = {
  render: () => (
    <div className="kit-section">
      <span className="eyebrow">Members</span>
      <nav className="settings-tabs">
        <a className="settings-tab" href="#tab">
          Overview
        </a>
        <a className="settings-tab" href="#tab" aria-current="page">
          Members
        </a>
        <a className="settings-tab" href="#tab">
          Invites
        </a>
      </nav>
      <div className="day-divider eyebrow">Today</div>
      <div className="new-divider eyebrow">New</div>
    </div>
  ),
};

export const Text: StoryObj = {
  render: () => (
    <div className="kit-section">
      <span>
        Hey <span className="mention">@ada</span>, the deploy is up.
      </span>
      <p className="hint">A hint: one line of help under a heading.</p>
      <p className="muted small">Muted, small: a timestamp or a size.</p>
      <p className="error">An error: what was refused, and why.</p>
    </div>
  ),
};
