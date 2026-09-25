#!/usr/bin/env node
// Cuts every derived brand file from the masters in brand/masters/:
// the web icon set straight into web/public/, and everything other
// consumers copy out of brand/dist/ (the desktop shell, the press set).
//
//   make brand
//
// Renders with the Chromium that web/'s Playwright installs; the .icns
// step needs macOS (iconutil). docs/brand.md has the sizes and who reads
// each file.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { chromium } = createRequire(join(root, "web/package.json"))("@playwright/test");

const masters = join(here, "masters");
const dist = join(here, "dist");
const pub = join(root, "web/public");
const svg = (name) => readFileSync(join(masters, `${name}.svg`), "utf8");
const browser = await chromium.launch();
const tmp = mkdtempSync(join(tmpdir(), "stoop-brand-"));

// Renders one master at size×size CSS px, scale× device pixels, with an
// optional drawn size and offset (the tray glyph sits inside its canvas).
async function raster(name, out, size, { scale = 1, draw = size, offset = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: scale });
  const data = Buffer.from(svg(name)).toString("base64");
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{position:absolute;left:${offset}px;top:${offset}px;width:${draw}px;height:${draw}px}</style>` +
      `<img src="data:image/svg+xml;base64,${data}">`,
  );
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}

async function icoFrom(name, out, sizes) {
  const pngs = [];
  for (const px of sizes) {
    const file = join(tmp, `${name}-${px}.png`);
    await raster(name, file, px);
    pngs.push(readFileSync(file));
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, ico(sizes, pngs));
}

function copy(name, out) {
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(masters, name), out);
}

// ---- web/public ------------------------------------------------------------

copy("favicon.svg", join(pub, "favicon.svg"));
copy("favicon-live.svg", join(pub, "favicon-live.svg"));
await icoFrom("favicon", join(pub, "favicon.ico"), [16, 32, 48]);
await raster("icon-square", join(pub, "apple-touch-icon.png"), 180);
await raster("icon-square", join(pub, "icon-192.png"), 192);
await raster("icon-square", join(pub, "icon-512.png"), 512);
await raster("icon-maskable", join(pub, "icon-maskable-512.png"), 512);
await raster("badge", join(pub, "badge-96.png"), 96);

// ---- dist/desktop ----------------------------------------------------------

const desk = join(dist, "desktop");
rmSync(desk, { recursive: true, force: true });
await raster("icon-rounded", join(desk, "icon.png"), 512);
for (const px of [16, 32, 48, 64, 128, 256, 512]) {
  await raster("icon-rounded", join(desk, "icons", `${px}x${px}.png`), px);
}
await icoFrom("icon-square", join(desk, "icon.ico"), [16, 24, 32, 48, 64, 128, 256]);

const set = join(tmp, "icon.iconset");
for (const [px, name] of [
  [16, "16x16"], [32, "16x16@2x"], [32, "32x32"], [64, "32x32@2x"], [128, "128x128"],
  [256, "128x128@2x"], [256, "256x256"], [512, "256x256@2x"], [512, "512x512"], [1024, "512x512@2x"],
]) {
  await raster("icon-macos", join(set, `icon_${name}.png`), px);
}
if (process.platform === "darwin") {
  execFileSync("iconutil", ["-c", "icns", set, "-o", join(desk, "icon.icns")]);
} else {
  console.warn("skipping icon.icns: iconutil needs macOS");
}

// The mark's 48-unit box at 16 pt inside the 22 pt menu bar canvas.
const draw = (64 * 16) / 48;
const offset = 3 - (8 * 16) / 48;
await raster("menubar-template", join(desk, "tray/trayTemplate.png"), 22, { draw, offset });
await raster("menubar-template", join(desk, "tray/trayTemplate@2x.png"), 22, { scale: 2, draw, offset });
await icoFrom("icon-square", join(desk, "tray/tray.ico"), [16, 24, 32, 48]);
await raster("icon-rounded", join(desk, "tray/tray.png"), 32);
copy("mark-ember.svg", join(desk, "mark.svg"));

// ---- dist/press ------------------------------------------------------------

const press = join(dist, "press");
rmSync(press, { recursive: true, force: true });
mkdirSync(press, { recursive: true });
for (const [name, fill] of [["brownstone", "#b5482f"], ["ember", "#e2725b"], ["sandstone", "#f6f1e8"], ["asphalt", "#1f1d1a"]]) {
  writeFileSync(join(press, `mark-${name}.svg`), svg("mark").replace("<path", `<path fill="${fill}"`));
}
await raster("icon-rounded", join(press, "icon-1024.png"), 1024);
await raster("icon-rounded", join(press, "icon-256.png"), 256);

await browser.close();
rmSync(tmp, { recursive: true });

// An .ico is a 6-byte header, a 16-byte directory entry per image, then
// the PNG bodies back to back.
function ico(sizes, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let at = 6 + dir.length;
  pngs.forEach((png, i) => {
    const e = i * 16;
    dir[e] = sizes[i] % 256;
    dir[e + 1] = sizes[i] % 256;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(at, e + 12);
    at += png.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}
