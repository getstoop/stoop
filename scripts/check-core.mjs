#!/usr/bin/env node
// web/src/core/ is shared with the phone app as source (`@stoop/core/*`,
// mobile/README.md → Code shared with web), so it imports nothing the app
// lacks: only core itself, the generated client in web/src/gen, and the
// protobuf runtime, plus vitest in its tests. Anything that reaches the
// DOM, a store, React or a web package belongs in web/src/api/.
// Run by `make lint`, beside check-fields.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "web/src/core");
const gen = join(root, "web/src/gen");
const PACKAGES = ["@bufbuild/protobuf", "@bufbuild/protobuf/wkt"];

function* tsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

const IMPORT = /(?:^|\s)(?:import|export)\b[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']/g;

function allowed(file, spec) {
  if (spec.startsWith(".")) {
    const target = resolve(dirname(file), spec);
    return target.startsWith(core + "/") || target.startsWith(gen + "/");
  }
  if (spec === "vitest") return file.endsWith(".test.ts");
  return PACKAGES.includes(spec);
}

let failed = 0;
for (const file of tsFiles(core)) {
  for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
    const spec = match[1] ?? match[2];
    if (allowed(file, spec)) continue;
    console.error(
      `${relative(root, file)}  imports "${spec}": core may import only core, web/src/gen and @bufbuild/protobuf`,
    );
    failed++;
  }
}
if (failed) process.exit(1);
console.log("ok  core");
