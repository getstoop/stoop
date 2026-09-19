const RADII = ["sm", "", "md", "lg", "pill"] as const;
const SIZES = ["xs", "sm", "ui", "body", "lg", "xl", "display"] as const;
const SWATCHES = [
  "canvas",
  "surface",
  "panel",
  "raised",
  "ok-soft",
  "warn-soft",
  "danger-soft",
  "danger-border",
] as const;

export function Foundations() {
  return (
    <section className="kit-section">
      <h2>Foundations</h2>
      <span className="eyebrow">Radius</span>
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
      <span className="eyebrow">Type</span>
      {SIZES.map((s) => (
        <div key={s} className="kit-type">
          <code>--text-{s}</code>
          <span style={{ fontSize: `var(--text-${s})` }}>
            The quick brown fox
          </span>
        </div>
      ))}
      <div className="kit-type">
        <code>--font-mono</code>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          The quick brown fox
        </span>
      </div>
      <span className="eyebrow">Surfaces and status tints</span>
      <div className="kit-row">
        {SWATCHES.map((s) => (
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
