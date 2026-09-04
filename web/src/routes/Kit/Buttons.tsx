import { GearIcon } from "../../components/Icons";

export function Buttons() {
  return (
    <section className="kit-section">
      <h2>Buttons</h2>
      <span className="kit-label">Primary</span>
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
      <span className="kit-label">Chip</span>
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
      <span className="kit-label">Icon button</span>
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
    </section>
  );
}
