export function Fields() {
  return (
    <section className="kit-section">
      <h2>Fields</h2>
      <div className="card">
        <h3>Profile</h3>
        <p className="hint">Words above the field; the card stretches it.</p>
        <label>
          Display name
          <input type="text" defaultValue="alice" />
        </label>
        <label>
          Invite code
          <input type="text" defaultValue="STP-4X9" aria-invalid="true" />
          <span className="error">
            That code has expired. Ask for a new one.
          </span>
        </label>
        <label>
          Who can register
          <select defaultValue="invite">
            <option value="invite">Invite only</option>
            <option value="open">Anyone with the link</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label>
          Description
          <textarea rows={2} placeholder="What is this place for?" />
        </label>
        <label className="toggle-row">
          <input type="checkbox" defaultChecked />
          <span>Play a sound when I am mentioned</span>
        </label>
        <div className="card-row">
          <button type="button" className="primary">
            Save
          </button>
          <button type="button" className="chip">
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
