import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = { title: "Kit/Surfaces" };
export default meta;

export const Card: StoryObj = {
  render: () => (
    <div className="kit-row stretch">
      <div className="card">
        <h3>Storage</h3>
        <p className="hint">Attachments count against the space quota.</p>
        <p>4.2 GB of 10 GB used</p>
        <div className="card-row">
          <button type="button" className="chip">
            Change quota
          </button>
        </div>
      </div>
      <div className="card danger-zone">
        <h3>Danger zone</h3>
        <p className="hint">These cannot be undone.</p>
        <div className="card-row">
          <button type="button" className="chip danger">
            Delete space
          </button>
        </div>
      </div>
    </div>
  ),
};

export const Callout: StoryObj = {
  render: () => (
    <div className="kit-section">
      <div className="callout">
        <strong>Set this server's public URL first.</strong> Login providers
        need it to build their callback URL.
      </div>
      <p className="callout warn">
        Copy it now. This is the only time it will be shown.
      </p>
    </div>
  ),
};

// The look only; <Modal> supplies the scrim and the behaviour.
export const ModalPanel: StoryObj = {
  render: () => (
    <div className="modal">
      <div className="modal-header">
        <h2>Invite people</h2>
        <button type="button" className="icon-button" aria-label="Close">
          ×
        </button>
      </div>
      <p className="muted">A modal is the same panel, floated.</p>
    </div>
  ),
};

export const Popover: StoryObj = {
  render: () => (
    <div className="kit-row">
      <div className="popover kit-panel">
        A popover: the panel every menu, picker and tooltip floats on
      </div>
    </div>
  ),
};
