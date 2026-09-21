import type { Meta, StoryObj } from "@storybook/react-vite";
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

const meta: Meta = { title: "Kit/Foundations" };
export default meta;

export const Radius: StoryObj = {
  render: () => (
    <div className="kit-section">
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
    </div>
  ),
};

export const Type: StoryObj = {
  render: () => (
    <div className="kit-section">
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
    </div>
  ),
};

export const Grounds: StoryObj = {
  render: () => (
    <div className="kit-section">
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
    </div>
  ),
};
