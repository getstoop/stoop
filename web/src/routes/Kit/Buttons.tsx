import { GearIcon } from "../../components/Icons";

export function Buttons() {
  return (
    <section className="kit-section">
      <h2>Buttons</h2>
      <span className="eyebrow">Primary</span>
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
      <span className="eyebrow">Quiet</span>
      <div className="kit-row">
        <button type="button" className="primary">
          Save
        </button>
        <button type="button" className="quiet">
          Not now
        </button>
        <button type="button" className="quiet danger">
          Discard draft
        </button>
        <button type="button" className="quiet" disabled>
          Undo
        </button>
      </div>
      <span className="eyebrow">Chip</span>
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
      <span className="eyebrow">Link</span>
      <div className="kit-row">
        <button type="button" className="link">
          Continue in this browser
        </button>
      </div>
      <span className="eyebrow">Option</span>
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
      <span className="eyebrow">Icon button</span>
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
