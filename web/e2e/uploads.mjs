import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, png, sleep } from "./lib.mjs";

// File uploads, phase 1: avatars and space icons. Besides what the UI
// shows, this spec measures two things the UI can't: the served image's
// real pixel size, and the blob on disk before and after a replacement
// (the data dir is STOOP_STORAGE_DIR, resolved against the repo root the
// server runs from).

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(
  join(here, "..", ".."),
  process.env.STOOP_STORAGE_DIR ?? "./data",
);

const dir = mkdtempSync(join(tmpdir(), "stoop-uploads-"));
const files = {
  red: join(dir, "red.png"),
  blue: join(dir, "blue.png"),
  icon: join(dir, "icon.png"),
  notPng: join(dir, "notes.png"),
  huge: join(dir, "huge.png"),
};
writeFileSync(
  files.red,
  png(300, 200, () => [220, 40, 40]),
);
writeFileSync(
  files.blue,
  png(120, 120, () => [40, 60, 220]),
);
writeFileSync(
  files.icon,
  png(64, 64, (x, y) => [x * 4, y * 4, 90]),
);
writeFileSync(files.notPng, "this is a text file wearing a .png extension\n");
// Random pixels don't compress: 950×950 RGB noise is well over 2 MB.
writeFileSync(
  files.huge,
  png(950, 950, () => [
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
  ]),
);

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const wire = (p, tag) =>
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
const suffix = String(Date.now() % 1000000);
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  wire(p, tag);
  p.on("dialog", (d) => d.accept());
  return p;
};
const fetchStatus = (page, path) =>
  page.evaluate(async (p) => {
    // The server marks files immutable, so bypass the browser cache to
    // observe the current status of a replaced id.
    const r = await fetch(p, { cache: "no-store" });
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      nosniff: r.headers.get("x-content-type-options"),
      cache: r.headers.get("cache-control"),
      disposition: r.headers.get("content-disposition"),
    };
  }, path);

// A sets up; B joins via the link.
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("expected a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
// Setup step 3 (reaching your server) is skippable.
await A.click("button.reach-continue");
await sleep(800);
await A.waitForSelector(".link-box code", { timeout: 3000 });
const link = await A.$eval(".link-box code", (e) => e.textContent);
await A.click("button.primary");
await sleep(1200);
const spaceId = new URL(A.url()).pathname.split("/")[2];

const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);

// --- avatar: rejects first, then a real upload
await A.goto(`${base}/profile`, { waitUntil: "networkidle0" });
await sleep(500);
check(
  (await A.$(".profile-header .avatar[data-file-id]")) === null,
  "profile shows initials before any upload",
);
const pick = async (page, path) => {
  const input = await page.$('input[type="file"]');
  await input.uploadFile(path);
};
await pick(A, files.huge);
await sleep(800);
let err = await A.$eval(".upload-error", (e) => e.textContent).catch(
  () => null,
);
check(
  err?.includes("2 MB"),
  `oversize file rejected with a visible error (${err})`,
);
check(
  (await A.$(".profile-header .avatar[data-file-id]")) === null,
  "oversize file did not become the avatar",
);
await pick(A, files.notPng);
await sleep(1200);
err = await A.$eval(".upload-error", (e) => e.textContent).catch(() => null);
check(
  err?.includes("not a supported image"),
  `.txt renamed .png rejected by the server (${err})`,
);
// The server cap is enforced independently of the client check.
const serverCap = await A.evaluate(async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const r = await fetch("/stoop.files.v1.FileService/UploadAvatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: btoa(s) }),
  });
  return { status: r.status, body: await r.json() };
});
check(
  serverCap.status === 400 && serverCap.body.code === "invalid_argument",
  `server rejects an oversize upload on its own (${serverCap.status} ${serverCap.body.code}: ${serverCap.body.message})`,
);

await pick(A, files.red);
await A.waitForSelector(".profile-header .avatar[data-file-id]", {
  timeout: 4000,
});
const firstId = await A.$eval(
  ".profile-header .avatar[data-file-id]",
  (e) => e.dataset.fileId,
);
check(!!firstId, `avatar uploaded (${firstId})`);
check(
  (await A.$(".space-pill.avatar .avatar[data-file-id]")) !== null,
  "rail pill shows the avatar",
);
check(
  existsSync(join(dataDir, "avatar", firstId)),
  `blob is in the data dir (${join("avatar", firstId)})`,
);
const served = await fetchStatus(A, `/files/${firstId}`);
check(
  served.status === 200 &&
    served.type === "image/png" &&
    served.nosniff === "nosniff" &&
    served.cache?.includes("immutable") &&
    served.disposition === "inline",
  `GET /files/{id} headers (${JSON.stringify(served)})`,
);
const dims = await A.evaluate(async (p) => {
  const bmp = await createImageBitmap(await (await fetch(p)).blob());
  return [bmp.width, bmp.height];
}, `/files/${firstId}`);
check(
  dims[0] === 256 && dims[1] === 256,
  `served avatar is 256×256 (got ${dims.join("×")})`,
);

// B sees it live: members panel, and the user card.
await sleep(1000);
check(
  (await B.$(".members-panel .avatar[data-file-id]")) !== null,
  "B's members panel shows A's avatar live",
);
await B.click(".member-row");
await B.waitForSelector(".user-card", { timeout: 3000 });
await sleep(400);
const cardId = await B.$eval(
  ".user-card .avatar[data-file-id]",
  (e) => e.dataset.fileId,
).catch(() => null);
check(cardId === firstId, `user card shows the avatar (${cardId})`);
await B.keyboard.press("Escape");
await sleep(200);

// --- replace: new id, old blob gone, old id 404
await pick(A, files.blue);
await A.waitForFunction(
  (old) =>
    document.querySelector(".profile-header .avatar[data-file-id]")?.dataset
      .fileId !== old,
  { timeout: 4000 },
  firstId,
);
const secondId = await A.$eval(
  ".profile-header .avatar[data-file-id]",
  (e) => e.dataset.fileId,
);
check(secondId !== firstId, `replacement got a new id (${secondId})`);
await sleep(300);
check(
  existsSync(join(dataDir, "avatar", secondId)),
  "new blob is in the data dir",
);
check(
  !existsSync(join(dataDir, "avatar", firstId)),
  "previous blob was deleted from the data dir",
);
check(
  (await fetchStatus(A, `/files/${firstId}`)).status === 404,
  "previous id is 404",
);
await sleep(800);
const bPanelId = await B.$eval(
  ".members-panel .avatar[data-file-id]",
  (e) => e.dataset.fileId,
);
check(
  bPanelId === secondId,
  "B's members panel switched to the new avatar live",
);

// --- space icon in a second space B is not a member of
const second = await A.evaluate(async () => {
  const r = await fetch("/stoop.chat.v1.ChatService/CreateSpace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Private Club" }),
  });
  return (await r.json()).space.id;
});
await A.goto(`${base}/s/${second}/settings`, { waitUntil: "networkidle0" });
await sleep(600);
check(
  (await A.$(".space-settings-title [data-file-id]")) === null,
  "settings header shows initials before an icon is set",
);
await pick(A, files.icon);
await A.waitForSelector(".space-settings-title [data-file-id]", {
  timeout: 4000,
});
const iconId = await A.$eval(
  ".space-settings-title [data-file-id]",
  (e) => e.dataset.fileId,
);
check(
  existsSync(join(dataDir, "space_icon", iconId)),
  `icon blob is in the data dir (${join("space_icon", iconId)})`,
);
check(
  (await A.$$eval(
    ".space-rail-list .space-pill [data-file-id]",
    (es) => es.length,
  )) === 1,
  "rail pill for the second space shows the icon",
);
const iconDims = await A.evaluate(async (p) => {
  const bmp = await createImageBitmap(await (await fetch(p)).blob());
  return [bmp.width, bmp.height];
}, `/files/${iconId}`);
check(
  iconDims[0] === 512 && iconDims[1] === 512,
  `served icon is 512×512 (got ${iconDims.join("×")})`,
);
const asNonMember = await fetchStatus(B, `/files/${iconId}`);
check(
  asNonMember.status === 403,
  `GET /files/{id} for a space icon as a non-member is 403 (got ${asNonMember.status})`,
);
check(
  (await fetchStatus(B, `/files/${secondId}`)).status === 200,
  "…while A's avatar is visible to B",
);
const anon = await newPage("anon");
await anon.goto(`${base}/login`, { waitUntil: "networkidle0" });
check(
  (await fetchStatus(anon, `/files/${secondId}`)).status === 401,
  "signed-out GET /files/{id} is 401",
);

// A member of the shared space sees its icon live once one is set there.
await A.goto(`${base}/s/${spaceId}/settings`, { waitUntil: "networkidle0" });
await sleep(600);
await pick(A, files.icon);
await A.waitForSelector(".space-settings-title [data-file-id]", {
  timeout: 4000,
});
await sleep(1000);
check(
  (await B.$(".space-rail-list .space-pill [data-file-id]")) !== null,
  "B's rail shows the shared space's new icon live",
);
check(
  (await B.$(".sidebar-header .header-icon[data-file-id]")) !== null,
  "B's space header shows the icon",
);

await browser.close();
rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
