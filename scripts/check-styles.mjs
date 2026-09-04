#!/usr/bin/env node
// Every sheet under web/src/styles must build on the tokens: no literal
// radius, font size, weight, z-index, duration or colour, and every gap
// and padding on the spacing scale (docs/conventions.md → Design tokens).
// A declaration that has to break a rule carries a comment on the line
// before it (or the same line) containing "off-scale:" and the reason.
// Run by `make lint`, beside check-themes.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../web/src/styles");
const SCALE = new Set([0, 2, 4, 6, 8, 12, 16, 20, 24, 32]);
const WEIGHTS = new Set(["400", "600", "700", "inherit"]);
const ESCAPE = /off-scale:/;

const isVar = (v) => /^var\(--[a-z-]+\)$/.test(v);
const checks = {
  "border-radius": (v) =>
    v.split(/\s+/).every((t) => isVar(t) || t === "0" || t === "50%" || t === "inherit")
      ? null
      : "border-radius must be a --radius token, 0, 50% or inherit",
  "font-size": (v, file) =>
    isVar(v) || /^[\d.]+(em|%)$/.test(v) || v === "inherit" || (file === "mobile.css" && v === "16px")
      ? null
      : "font-size must be a --text token (or em/%; 16px only in mobile.css)",
  "font-weight": (v) => (WEIGHTS.has(v) ? null : "font-weight must be 400, 600 or 700"),
  "z-index": (v) =>
    isVar(v) || v === "1" || v === "2" || v === "auto"
      ? null
      : "z-index must be a --z token (1 or 2 for stacking inside a component)",
  transition: (v) => (/\b\d+(\.\d+)?m?s\b/.test(v) ? "transition must use --dur / --dur-fast" : null),
};
const spacing = (v) => {
  for (const t of v.split(/\s+/)) {
    const m = /^(-?[\d.]+)px$/.exec(t);
    if (m && !SCALE.has(Math.abs(Number(m[1])))) return `${t} is off the spacing scale (2 4 6 8 12 16 20 24 32)`;
  }
  return null;
};
const colour = (v) => (/#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/i.test(v) ? "colour literal; use a theme token" : null);

let failed = false;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".css")).sort()) {
  const lines = readFileSync(join(dir, file), "utf8").split("\n");
  let escaped = false;
  let pending = null; // a declaration continued over several lines
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (ESCAPE.test(raw)) escaped = true;
    // Strip comments so a "12px" in prose does not count.
    const line = raw.replace(/\/\*.*?\*\//g, "").trim();
    if (!line || line.startsWith("/*") || line.startsWith("*") || line.endsWith("*/")) continue;
    let decl;
    if (pending) {
      pending.value += ` ${line}`;
      if (!line.endsWith(";")) continue;
      decl = pending;
      pending = null;
    } else {
      const m = /^([a-z-]+):\s*(.*)$/.exec(line);
      if (!m || line.endsWith("{")) continue;
      if (!m[2].endsWith(";")) {
        pending = { prop: m[1], value: m[2], line: i + 1 };
        continue;
      }
      decl = { prop: m[1], value: m[2], line: i + 1 };
    }
    const value = decl.value.replace(/;$/, "").trim();
    const problems = [];
    if (checks[decl.prop]) problems.push(checks[decl.prop](value, file));
    if (decl.prop === "gap" || decl.prop.startsWith("padding")) problems.push(spacing(value));
    problems.push(colour(value));
    for (const p of problems.filter(Boolean)) {
      if (escaped) continue;
      console.error(`${file}:${decl.line}: ${p}`);
      failed = true;
    }
    escaped = false;
  }
}
console.log(failed ? "styles: failed" : "ok  styles");
process.exit(failed ? 1 : 0);
