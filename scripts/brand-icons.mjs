#!/usr/bin/env node
// Cuts every raster icon from the SVG masters in web/brand/.
//
//   node scripts/brand-icons.mjs [path-to-desktop-repo]
//
// Always writes the web icon set into web/public/. Given the desktop
// checkout it also writes resources/icon.{png,icns,ico} and the tray
// template pair there. Renders with the Chromium that web/'s Playwright
// already installs; the .icns needs macOS (iconutil). docs/brand.md
// explains the sizes.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "web/package.json"))("@playwright/test");
const desktop = process.argv[2];

const masters = join(root, "web/brand");
const svg = (name) => readFileSync(join(masters, `${name}.svg`), "utf8");
const browser = await chromium.launch();

// Renders one master at size×size CSS px, scale× device pixels, with
// optional offset and drawn size (for the tray canvas).
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

const pub = join(root, "web/public");
await raster("icon-square", join(pub, "apple-touch-icon.png"), 180);
await raster("icon-square", join(pub, "icon-192.png"), 192);
await raster("icon-square", join(pub, "icon-512.png"), 512);
await raster("icon-maskable", join(pub, "icon-maskable-512.png"), 512);

if (desktop) {
  const res = join(desktop, "resources");
  await raster("icon-rounded", join(res, "icon.png"), 512);

  // The mark's 48-unit box at 16 pt inside the 22 pt menu bar canvas.
  const draw = (64 * 16) / 48;
  const offset = 3 - (8 * 16) / 48;
  await raster("menubar-template", join(res, "tray/trayTemplate.png"), 22, { draw, offset });
  await raster("menubar-template", join(res, "tray/trayTemplate@2x.png"), 22, { scale: 2, draw, offset });

  const tmp = mkdtempSync(join(tmpdir(), "stoop-icons-"));
  const set = join(tmp, "icon.iconset");
  for (const [px, name] of [
    [16, "16x16"], [32, "16x16@2x"], [32, "32x32"], [64, "32x32@2x"], [128, "128x128"],
    [256, "128x128@2x"], [256, "256x256"], [512, "256x256@2x"], [512, "512x512"], [1024, "512x512@2x"],
  ]) {
    await raster("icon-macos", join(set, `icon_${name}.png`), px);
  }
  if (process.platform === "darwin") {
    execFileSync("iconutil", ["-c", "icns", set, "-o", join(res, "icon.icns")]);
  } else {
    console.warn("skipping icon.icns: iconutil needs macOS");
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const px of sizes) {
    const file = join(tmp, `ico-${px}.png`);
    await raster("icon-square", file, px);
    pngs.push(readFileSync(file));
  }
  writeFileSync(join(res, "icon.ico"), ico(sizes, pngs));
  rmSync(tmp, { recursive: true });
}

await browser.close();

// An .ico is a 6-byte header, a 16-byte directory entry per image, then
// the PNG bodies back to back.
function ico(sizes, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const e = i * 16;
    dir[e] = sizes[i] % 256;
    dir[e + 1] = sizes[i] % 256;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}
