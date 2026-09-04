const RADII = ["sm", "", "md", "lg", "pill"] as const;
const SIZES = ["xs", "sm", "ui", "body", "lg", "xl", "display"] as const;

export function Foundations() {
  return (
    <section className="kit-section">
      <h2>Foundations</h2>
      <span className="kit-label">Radius</span>
      <div className="kit-row">
        {RADII.map((r) => {
          const name = r ? `--radius-${r}` : "--radius";
          return (
            <div
              key={name}
              className="kit-type"
              style={{ gridTemplateColumns: "56px 1fr" }}
            >
              <div
                className="kit-swatch"
                style={{ borderRadius: `var(${name})` }}
              />
              <code>{name}</code>
            </div>
          );
        })}
      </div>
      <span className="kit-label">Type</span>
      {SIZES.map((s) => (
        <div key={s} className="kit-type">
          <code>--text-{s}</code>
          <span style={{ fontSize: `var(--text-${s})` }}>
            The quick brown fox
          </span>
        </div>
      ))}
      <span className="kit-label">Surfaces</span>
      <div className="kit-row">
        {["canvas", "surface", "panel", "raised"].map((s) => (
          <div
            key={s}
            className="kit-type"
            style={{ gridTemplateColumns: "56px 1fr" }}
          >
            <div className="kit-swatch" style={{ background: `var(--${s})` }} />
            <code>--{s}</code>
          </div>
        ))}
      </div>
    </section>
  );
}
