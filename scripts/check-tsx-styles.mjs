#!/usr/bin/env node
// An inline style in web/src/**/*.tsx carries computed geometry only:
// position, size, transform, transition and CSS custom properties
// (docs/conventions.md → Design tokens). Everything else is a class.
// Only object literals are judged; style={expr} passes, since what a
// call or a variable holds can't be read from here. A style that has to
// break the rule carries a comment on the line before it (or the same
// line) containing "off-scale:" and the reason.
// Run by `make lint`, beside check-styles.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "web/src");
const SKIP = join(src, "gen");
const ALLOWED = new Set([
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "transform",
  "transition",
]);
const ESCAPE = /off-scale:/;

function* tsxFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (path === SKIP) continue;
    if (e.isDirectory()) yield* tsxFiles(path);
    else if (e.name.endsWith(".tsx")) yield path;
  }
}

// Blank out comments and the insides of strings, keeping every offset, so
// the braces, commas and colons left are the expression's own. A quoted
// key keeps its name; a template's ${} goes with the template.
function blank(text) {
  return text
    .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, "_"))
    .replace(/(["'])((?:[^"'\\\n]|\\.)*?)\1/g, (_, q, body) => q + body.replace(/[^\w-]/g, "_") + q);
}

// The index of the brace that closes the one at `open`.
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return text.length;
}

// The keys of every object literal between start and end, with offsets.
function keys(text, start, end) {
  const found = [];
  for (let i = start; i < end; i++) {
    if (text[i] !== "{") continue;
    const close = closing(text, i);
    let depth = 0;
    let entry = i + 1;
    for (let j = i + 1; j <= close; j++) {
      const c = text[j];
      if (j < close && "([{".includes(c)) depth++;
      else if (j < close && ")]}".includes(c)) depth--;
      if (depth > 0 || (c !== "," && j !== close)) continue;
      const m = /^\s*(?:"([\w-]+)"|'([\w-]+)'|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(text.slice(entry, j));
      if (m) found.push({ key: m[1] ?? m[2] ?? m[3], at: entry + m[0].search(/\S/) });
      entry = j + 1;
    }
  }
  return found;
}

let failed = false;
for (const file of [...tsxFiles(src)].sort()) {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  const lineOf = (offset) => raw.slice(0, offset).split("\n").length;
  const escaped = (line) => ESCAPE.test(lines[line - 1]) || ESCAPE.test(lines[line - 2] ?? "");
  for (const m of raw.matchAll(/\bstyle=\{/g)) {
    const open = m.index + m[0].length - 1;
    // Balanced on the raw text: a template's ${} closes itself.
    const close = closing(raw, open);
    const text = raw.slice(0, open + 1) + blank(raw.slice(open + 1, close)) + raw.slice(close);
    if (escaped(lineOf(m.index))) continue;
    for (const { key, at } of keys(text, open + 1, close)) {
      if (ALLOWED.has(key) || key.startsWith("--")) continue;
      const line = lineOf(at);
      if (escaped(line)) continue;
      console.error(`${relative(root, file)}:${line}: inline style sets ${key}; use a class (geometry and custom properties only)`);
      failed = true;
    }
  }
}
console.log(failed ? "tsx styles: failed" : "ok  tsx styles");
process.exit(failed ? 1 : 0);
