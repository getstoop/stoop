import type { CSSProperties } from "react";

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
            <div key={name} className="kit-type swatch">
              <div
                className="kit-swatch"
                style={{ "--kit-radius": `var(${name})` } as CSSProperties}
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
          <span style={{ "--kit-size": `var(--text-${s})` } as CSSProperties}>
            The quick brown fox
          </span>
        </div>
      ))}
      <div className="kit-type">
        <code>--font-mono</code>
        <span className="kit-mono">The quick brown fox</span>
      </div>
      <span className="eyebrow">Surfaces and status tints</span>
      <div className="kit-row">
        {SWATCHES.map((s) => (
          <div key={s} className="kit-type swatch">
            <div
              className="kit-swatch"
              style={{ "--kit-fill": `var(--${s})` } as CSSProperties}
            />
            <code>--{s}</code>
          </div>
        ))}
      </div>
    </section>
  );
}
