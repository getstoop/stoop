// Where a space puts someone who arrives without a channel of their own:
// the channel it chooses, the first-channel fallback when it has chosen
// none, and what happens once the chosen channel is deleted (STOOP-109).
import puppeteer from "puppeteer-core";
import { acceptDialog, BASE as base, chromePath, sleep } from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 1280, height: 900 });
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  return p;
};
const suffix = String(Date.now() % 1000000);
const path = (p) => new URL(p.url()).pathname;
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => "");
const SELECT = 'select[name="default-channel"]';

// The dropdown holds channel ids, so pick by the name a person reads.
const chooseDefault = async (p, label) => {
  const value = await p.$$eval(
    `${SELECT} option`,
    (opts, want) => opts.find((o) => o.textContent.trim() === want)?.value,
    label,
  );
  if (value === undefined) throw new Error(`no option ${label}`);
  await p.select(SELECT, value);
  await sleep(800);
};
const chosen = async (p) =>
  p
    .$eval(SELECT, (e) => e.options[e.selectedIndex].textContent.trim())
    .catch(() => "");

const settings = async (p, spaceId) => {
  await p.goto(`${base}/s/${spaceId}/settings?tab=channels`, {
    waitUntil: "networkidle0",
  });
  await p.waitForSelector(SELECT, { timeout: 5000 });
  await sleep(400);
};

// ---- A sets the instance up and lands in #general
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("need a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
await A.click("button.reach-continue");
await sleep(800);
await A.waitForSelector(".link-box code", { timeout: 3000 });
const link = await A.$eval(".link-box code", (e) => e.textContent);
await A.click("button.primary");
await sleep(1200);
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const spaceId = path(A).split("/")[2];

// ---- A second text channel, and a voice channel that must stay out of
// the choices: landing someone there would open their microphone.
await A.click(".channel-group-heading .channel-add:not(.voice)");
await acceptDialog(A, "tools");
await sleep(800);
await A.click(".channel-group-heading .channel-add.voice");
await acceptDialog(A, "porch-swing");
await sleep(800);

await settings(A, spaceId);
const options = await A.$$eval(`${SELECT} option`, (os) =>
  os.map((o) => o.textContent.trim()),
);
check(
  options[0] === "First channel",
  `unset is the first option ("${options[0]}")`,
);
check(
  options.includes("# tools") && !options.includes("# porch-swing"),
  `text channels only (${options.join(", ")})`,
);
check(
  (await chosen(A)) === "First channel",
  "a space that has never chosen one shows the fallback",
);

// ---- Choose #tools, and B lands there rather than in #general
await chooseDefault(A, "# tools");
await settings(A, spaceId);
check((await chosen(A)) === "# tools", "the choice survives a reload");

const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(400);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);
check(
  (await text(B, ".channel-title")) === "tools",
  `an invite lands a new member in the chosen channel (got "${await text(B, ".channel-title")}")`,
);

// Opening the space with no channel in the URL goes the same way.
await B.goto(`${base}/s/${spaceId}`, { waitUntil: "networkidle0" });
await sleep(1200);
check(
  (await text(B, ".channel-title")) === "tools",
  "so does /s/{id} with nothing after it",
);

// ---- Delete the chosen channel. The space must not be left pointing at
// something that is gone.
await settings(A, spaceId);
const rows = await A.$$(".user-row");
for (const row of rows) {
  const name = await A.evaluate((e) => e.innerText, row);
  if (name.startsWith("# tools")) {
    const del = await row.$(".chip.danger");
    await del.click();
    break;
  }
}
await acceptDialog(A);
await sleep(1000);
check(
  (await chosen(A)) === "First channel",
  `deleting the chosen channel returns the space to the fallback (got "${await chosen(A)}")`,
);
const after = await A.$$eval(`${SELECT} option`, (os) =>
  os.map((o) => o.textContent.trim()),
);
check(
  !after.includes("# tools"),
  `the deleted channel is no longer on offer (${after.join(", ")})`,
);

// A member who was never told stays honest too: C arrives on the same
// invite and lands in #general, not in a channel that no longer exists.
const C = await newPage("C");
await C.goto(link, { waitUntil: "networkidle0" });
await sleep(400);
await C.type('input[autocomplete="username"]', `casey${suffix}`);
await C.type('input[type="password"]', "correct horse battery");
await C.click('button[type="submit"]');
await C.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);
check(
  (await text(C, ".channel-title")) === "general",
  `after the deletion an invite falls back to the first channel (got "${await text(C, ".channel-title")}")`,
);

// ---- The setting is out of a plain member's reach: settings bounce
// them back to the space, and the server refuses them either way
// (internal/chat/spaces_test.go).
await B.goto(`${base}/s/${spaceId}/settings`, { waitUntil: "networkidle0" });
await sleep(900);
check(
  path(B) !== `/s/${spaceId}/settings` && (await B.$(SELECT)) === null,
  `a member asking for settings is sent back to the space (at ${path(B)})`,
);

await browser.close();
console.log(fails ? `FAILED (${fails})` : "OK");
process.exit(fails ? 1 : 0);
