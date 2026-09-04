// Shared bits for the browser E2E specs. Each spec is a standalone script
// (run them individually with `node e2e/<name>.mjs` against a running
// server, or all of them via `pnpm e2e`, which also resets the database
// before each one).

import { existsSync } from "node:fs";
import { deflateSync } from "node:zlib";

export const BASE = process.env.STOOP_E2E_BASE_URL ?? "http://localhost:8091";

// Chrome/Chromium executable: STOOP_E2E_CHROME wins; otherwise the usual
// macOS app path, then common Linux binaries.
export function chromePath() {
  const candidates = [
    process.env.STOOP_E2E_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `no Chrome found; set STOOP_E2E_CHROME (tried ${candidates.join(", ")})`,
    );
  }
  return found;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A minimal PNG encoder (RGB, no filter) so specs can make images without
// fixtures. pixel(x, y) returns [r, g, b].
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
export function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The app's own dialogs (components/DialogHost.tsx) stand in for
// window.confirm / prompt / alert, so a spec answers them in the DOM.
const DIALOG = ".modal[data-dialog]";

export async function dialog(p) {
  await p.waitForSelector(DIALOG, { visible: true, timeout: 3000 });
  return p.$eval(DIALOG, (e) => ({
    kind: e.dataset.dialog,
    text: e.innerText,
  }));
}

// Presses the dialog's action; `answer` fills a prompt's field first.
export async function acceptDialog(p, answer) {
  await dialog(p);
  if (answer !== undefined) {
    // A long-answer prompt (a channel topic) uses a textarea instead. It
    // holds no newlines, so a triple-click still takes all of it.
    const field = `${DIALOG} :where(input, textarea)`;
    await p.click(field, { count: 3 });
    if (answer === "") await p.keyboard.press("Backspace");
    else await p.type(field, answer);
  }
  await p.click(`${DIALOG} .modal-actions .primary`);
  await p.waitForSelector(DIALOG, { hidden: true, timeout: 3000 });
  await sleep(200);
}

export async function dismissDialog(p) {
  await dialog(p);
  await p.keyboard.press("Escape");
  await p.waitForSelector(DIALOG, { hidden: true, timeout: 3000 });
}

// The space header's actions (About, Invite, Space settings, Leave) live
// behind its ⋮. Opens the menu and picks by label; returns false, with
// the menu closed again, when that item isn't offered.
export async function spaceMenu(p, label) {
  await p.click(".sidebar-header .dots-menu-button");
  await p.waitForSelector(".dots-menu button", { timeout: 3000 });
  for (const b of await p.$$(".dots-menu button")) {
    if ((await p.evaluate((e) => e.textContent?.trim(), b)) === label) {
      await b.click();
      await sleep(300);
      return true;
    }
  }
  await p.keyboard.press("Escape");
  await sleep(200);
  return false;
}

// What the space menu offers, for the checks that used to ask whether a
// chip was on screen.
export async function spaceMenuItems(p) {
  await p.click(".sidebar-header .dots-menu-button");
  await p.waitForSelector(".dots-menu button", { timeout: 3000 });
  const labels = await p.$$eval(".dots-menu button", (es) =>
    es.map((e) => e.textContent.trim()),
  );
  await p.keyboard.press("Escape");
  await sleep(200);
  return labels;
}
