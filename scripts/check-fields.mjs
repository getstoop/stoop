#!/usr/bin/env node
// A form field in web/src/**/*.tsx is a <Field> or a <SettingRow>, so its
// label, hint and error reach the control
// (docs/architecture/design-system.md → Fields). This refuses the two
// hand-built shapes they replaced: className="field" outside Field.tsx,
// and a <label> with neither htmlFor nor a class of its own (a toggle
// row, a picker row), which is words wrapped round a control.
// Run by `make lint`, beside check-tsx-styles.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "web/src");
const SKIP = join(src, "gen");
const FIELD = join(src, "components/Field.tsx");

function* tsxFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (path === SKIP) continue;
    if (e.isDirectory()) yield* tsxFiles(path);
    else if (e.name.endsWith(".tsx")) yield path;
  }
}

const RULES = [
  [/className="field(?:"| )/, 'className="field": use <Field>'],
  [/<label\s*>/, "a bare <label>: use <Field>, or give a toggle row its class"],
];

let failed = 0;
for (const file of tsxFiles(src)) {
  if (file === FIELD) continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const [pattern, why] of RULES) {
        if (!pattern.test(line)) continue;
        console.error(`${relative(root, file)}:${i + 1}  ${why}`);
        failed++;
      }
    });
}
if (failed) process.exit(1);
console.log("ok  fields");
