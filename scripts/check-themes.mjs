#!/usr/bin/env node
// Every theme in web/src/themes.css must keep text readable: WCAG AA
// 4.5:1 for --text and --accent (they carry body-size text), 3:1 for
// --text-muted, each against both --surface and --panel, and 3:1 for
// --on-accent on --accent (button labels and avatar initials: bold,
// short, and the UI-component threshold). Run by `make lint` so a
// palette that fails never ships.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../web/src/themes.css"),
  "utf8",
);
const blocks = [...css.matchAll(/\[data-theme="([a-z-]+)"\]\s*\{([^}]*)\}/g)];
if (blocks.length === 0) throw new Error("no themes found");

const hex = (h) => {
  const s = h.length === 4 ? [...h.slice(1)].map((c) => c + c).join("") : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const lum = ([r, g, b]) => {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

let failed = false;
for (const [, name, body] of blocks) {
  const tokens = Object.fromEntries(
    [...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
  );
  const need = ["canvas", "surface", "panel", "raised", "hover", "border", "text", "text-muted", "accent", "accent-soft", "on-accent", "ok", "warn", "danger", "shadow", "scrim"];
  for (const k of need) {
    if (!(k in tokens)) {
      console.error(`${name}: missing --${k}`);
      failed = true;
    }
  }
  const solid = (k) => (/^#[0-9a-f]{3,6}$/i.test(tokens[k] ?? "") ? hex(tokens[k]) : null);
  const checks = [
    ["text", "surface", 4.5], ["text", "panel", 4.5],
    ["accent", "surface", 4.5], ["accent", "panel", 4.5],
    ["text-muted", "surface", 3], ["text-muted", "panel", 3],
    ["on-accent", "accent", 3],
  ];
  const results = [];
  for (const [fg, bg, min] of checks) {
    const a = solid(fg), b = solid(bg);
    if (!a || !b) {
      console.error(`${name}: --${fg} and --${bg} must be solid hex colours`);
      failed = true;
      continue;
    }
    const r = ratio(a, b);
    results.push(`${fg}/${bg} ${r.toFixed(1)}`);
    if (r < min) {
      console.error(`${name}: --${fg} on --${bg} is ${r.toFixed(2)}:1, needs ${min}:1`);
      failed = true;
    }
  }
  console.log(`${failed ? "" : "ok  "}${name}: ${results.join(", ")}`);
}
process.exit(failed ? 1 : 0);
