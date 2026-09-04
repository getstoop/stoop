import { DotsMenu } from "../../components/DotsMenu";
import { Tooltip } from "../../components/Tooltip";
import { confirm, notice, prompt } from "../../stores/dialogs";

export function Surfaces() {
  return (
    <section className="kit-section">
      <h2>Surfaces</h2>
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
      <div className="modal" style={{ width: "auto" }}>
        <div className="modal-header">
          <h2>Invite people</h2>
          <button type="button" className="icon-button" aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted">A modal is the same panel, floated.</p>
      </div>
      <div className="kit-row">
        <span className="muted">
          A ⋮ menu: the row's actions, out of the way
        </span>
        <DotsMenu
          label="Options for the kit"
          items={[
            { label: "Make admin", onSelect: () => {} },
            { label: "Change username", onSelect: () => {} },
            { label: "Reset password", onSelect: () => {} },
            { label: "Deactivate", onSelect: () => {}, danger: true },
          ]}
        />
      </div>
      <div className="kit-row">
        <span className="muted">
          A tooltip: what a truncated row hasn't room to say
        </span>
        <Tooltip
          text="Ravenswood Ave"
          detail="Neighbours between 4th and 7th. Tool library and stoop sales."
          side="right"
        >
          <button type="button" className="chip">
            Hover, or tab to me
          </button>
        </Tooltip>
        <Tooltip text="Copy join link" side="bottom">
          <button
            type="button"
            className="icon-button"
            aria-label="Copy join link"
          >
            ⧉
          </button>
        </Tooltip>
      </div>
      <div className="kit-row">
        <button
          type="button"
          className="chip"
          onClick={() =>
            confirm({
              title: "Delete #general?",
              body: "All its messages go with it.",
              action: "Delete",
              danger: true,
            })
          }
        >
          Confirm
        </button>
        <button
          type="button"
          className="chip"
          onClick={() =>
            prompt({
              title: "New channel",
              label: "Channel name",
              action: "Create",
            })
          }
        >
          Prompt
        </button>
        <button
          type="button"
          className="chip"
          onClick={() =>
            prompt({
              title: "Delete this space",
              body: "Type the space name to confirm.",
              label: "Space name",
              match: "The Porch",
              action: "Delete space",
              danger: true,
            })
          }
        >
          Prompt (match)
        </button>
        <button
          type="button"
          className="chip"
          onClick={() =>
            notice({ title: "Couldn't join", body: "invite not found" })
          }
        >
          Notice
        </button>
      </div>
    </section>
  );
}
