#!/usr/bin/env node
// Writes mobile/src/theme/generated.ts from web/src/themes.css,
// web/src/tokens.css, the theme list in web/src/api/theme.ts and the
// Markdown values in web/src/styles/markdown.css, so the phone app wears
// the same themes, by the same names, and draws messages with the same
// values as the web app without anyone copying them by hand.
//
//   make mobile-theme        write generated.ts
//   ... --check              fail if generated.ts is not what it would write
//                            (make lint and CI run this)
//
// Every theme's colour tokens come across as written (React Native reads
// hex, rgba() and box-shadow strings). From tokens.css only the plain
// numbers come across: px and ms values lose their unit, unitless ones
// (leading) stay as they are. Fonts, colour mixes and focus rings do not:
// the app uses the platform font and builds its own focus states.
// markdown.css's --md-* block comes across whole as `markdown`, without
// the md- prefix: px and plain numbers as numbers, a var(--token) as the
// theme key to look up in the current theme ("textMuted"). Anything else
// fails here.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// --text-muted → textMuted
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const declarations = (body) =>
  [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]);

const themes = {};
for (const [, name, body] of read("web/src/themes.css").matchAll(
  /\[data-theme="([a-z-]+)"\]\s*\{([^}]*)\}/g,
)) {
  // color-scheme says whether the theme is light or dark, which the app
  // needs for the status bar.
  const scheme = body.match(/color-scheme:\s*(light|dark)/);
  if (!scheme) throw new Error(`${name}: no color-scheme`);
  themes[camel(name)] = {
    scheme: scheme[1],
    ...Object.fromEntries(declarations(body).map(([k, v]) => [camel(k), v])),
  };
}
if (!themes.brownstone) throw new Error("themes.css has no brownstone block");

const tokensCss = read("web/src/tokens.css");

// The status tints (--ok-soft and the rest) mix a theme colour with
// transparent, which is that colour at the mix's opacity. Mixes with
// anything else (--danger-border) don't come across.
const tints = tokensCss.match(/:root,\s*\[data-theme\]\s*\{([^}]*)\}/);
if (!tints) throw new Error("tokens.css has no status tint block");
for (const [k, v] of declarations(tints[1])) {
  const mix = v.match(/^color-mix\(in srgb, var\(--([a-z-]+)\) (\d+)%, transparent\)$/);
  if (!mix) continue;
  for (const theme of Object.values(themes)) {
    const hex = theme[camel(mix[1])];
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`--${mix[1]} is not a 6-digit hex colour`);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    theme[camel(k)] = `rgba(${r}, ${g}, ${b}, ${Number(mix[2]) / 100})`;
  }
}

// The first :root block of tokens.css is the one every theme shares.
const shared = tokensCss.match(/:root\s*\{([^}]*)\}/);
if (!shared) throw new Error("tokens.css has no :root block");
const tokens = {};
for (const [k, v] of declarations(shared[1])) {
  const number = v.match(/^(-?[0-9.]+)(px|ms)?$/);
  if (number) tokens[camel(k)] = Number(number[1]);
}

// The picker's list, in web's order: each theme's name, the tier the
// picker files it under, and its one-line blurb, read from THEMES in
// web/src/api/theme.ts. Every entry there is written id, name, kind,
// tier, then blurb further down; one that isn't fails here.
const themeTs = read("web/src/api/theme.ts");
const list = themeTs.match(/export const THEMES: ThemeInfo\[\] = \[([\s\S]*?)\n\];/);
if (!list) throw new Error("theme.ts has no THEMES list");
const themeList = [
  ...list[1].matchAll(
    /\{\s*id: "([a-z-]+)",\s*name: "([^"]+)",\s*kind: "(?:dark|light)",\s*tier: "(light|dim|dark)",[^}]*?blurb:\s*"([^"]*)"/g,
  ),
].map(([, id, label, tier, blurb]) => ({ name: camel(id), label, tier, blurb }));
for (const t of themeList) {
  if (!themes[t.name]) throw new Error(`${t.name}: in theme.ts but not themes.css`);
}
if (themeList.length !== Object.keys(themes).length) {
  throw new Error(`theme.ts lists ${themeList.length} themes, themes.css has ${Object.keys(themes).length}`);
}

// The values message Markdown is drawn with: the first block of
// markdown.css, every name in it --md-*.
const mdBlock = read("web/src/styles/markdown.css").match(/:root,\s*\[data-theme\]\s*\{([^}]*)\}/);
if (!mdBlock) throw new Error("markdown.css has no :root, [data-theme] block");
const markdown = {};
for (const [k, v] of declarations(mdBlock[1].replace(/\/\*[\s\S]*?\*\//g, ""))) {
  if (!k.startsWith("md-")) throw new Error(`markdown.css: --${k} is not an --md-* name`);
  const key = camel(k.slice(3));
  const number = v.match(/^([0-9.]+)(px)?$/);
  const ref = v.match(/^var\(--([a-z-]+)\)$/);
  if (number) {
    markdown[key] = Number(number[1]);
  } else if (ref) {
    for (const [name, theme] of Object.entries(themes)) {
      if (!(camel(ref[1]) in theme)) throw new Error(`markdown.css: --${k} names --${ref[1]}, which ${name} lacks`);
    }
    markdown[key] = camel(ref[1]);
  } else {
    throw new Error(`markdown.css: --${k}: ${v} is neither a px size, a number nor var(--theme-token)`);
  }
}

const out = `// Generated by scripts/gen-mobile-theme.mjs from web/src/themes.css,
// web/src/tokens.css, web/src/api/theme.ts and web/src/styles/markdown.css.
// Do not edit: change the web files and run \`make mobile-theme\`.

export const themes = ${JSON.stringify(themes, null, 2)} as const;

export const themeList = ${JSON.stringify(themeList, null, 2)} as const;

export const tokens = ${JSON.stringify(tokens, null, 2)} as const;

// Sizes in px, -scale as a multiple of the text size, and colours as the
// key of the current theme's colour.
export const markdown = ${JSON.stringify(markdown, null, 2)} as const;
`;
const target = "mobile/src/theme/generated.ts";
if (process.argv.includes("--check")) {
  if (read(target) !== out) {
    console.error(`${target} is out of date with web's styles: run \`make mobile-theme\` and commit the result.`);
    process.exit(1);
  }
  console.log("ok  mobile theme");
} else {
  writeFileSync(join(root, target), out);
}
