export function Parts() {
  return (
    <section className="kit-section">
      <h2>Small parts</h2>
      <div className="kit-row">
        <span className="badge">Admin</span>
        <span className="badge ok">Connected</span>
        <span className="badge warn">Reconnecting</span>
        <span className="badge danger">Expired</span>
      </div>
      <nav className="settings-tabs">
        <a className="settings-tab" href="/kit">
          Overview
        </a>
        <a className="settings-tab" href="/kit" aria-current="page">
          Members
        </a>
        <a className="settings-tab" href="/kit">
          Invites
        </a>
      </nav>
      <div className="day-divider">Today</div>
      <div className="new-divider">New</div>
      <div className="kit-row">
        <span className="avatar small">A</span>
        <span className="avatar medium">JH</span>
        <span className="avatar large">R</span>
        <span>
          Hey <span className="mention">@alice</span>, the deploy is up.
        </span>
      </div>
      <p className="muted small">Muted, small: a timestamp or a size.</p>
    </section>
  );
}
