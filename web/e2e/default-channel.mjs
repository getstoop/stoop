// Where a space puts someone who arrives without a channel of their own:
// the channel it chooses, the first-channel fallback when it has chosen
// none, and what happens once the chosen channel is deleted (STOOP-109).
import {
  acceptDialog,
  BASE as base,
  gotoShared,
  harness,
  seed,
  signIn,
  sleep,
  waitFor,
} from "./lib.mjs";

const { check, newPage: rawPage, done } = await harness();
const newPage = async (tag) => {
  const p = await rawPage(tag);
  await p.setViewport({ width: 1280, height: 900 });
  return p;
};
const { invite, space, suffix, tokens } = await seed({
  users: ["ada"],
  channels: ["general"],
  invite: true,
});
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

// ---- A lands in #general; B and C are not members until they arrive.
const A = await newPage("A");
await signIn(A, tokens.ada);
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const spaceId = space.id;

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
check(
  await waitFor(async () => (await chosen(A)) === "# tools"),
  "the choice survives a reload",
);

const B = await newPage("B");
await gotoShared(B, invite.url);
await sleep(400);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
check(
  await waitFor(async () => (await text(B, ".channel-title")) === "tools"),
  `an invite lands a new member in the chosen channel (got "${await text(B, ".channel-title")}")`,
);

// Opening the space with no channel in the URL goes the same way.
await gotoShared(B, `${base}/s/${spaceId}`, { waitUntil: "networkidle0" });
check(
  await waitFor(async () => (await text(B, ".channel-title")) === "tools"),
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
check(
  await waitFor(async () => (await chosen(A)) === "First channel"),
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
await gotoShared(C, invite.url);
await sleep(400);
await C.type('input[autocomplete="username"]', `casey${suffix}`);
await C.type('input[type="password"]', "correct horse battery");
await C.click('button[type="submit"]');
await C.waitForSelector(".composer textarea", { timeout: 8000 });
check(
  await waitFor(async () => (await text(C, ".channel-title")) === "general"),
  `after the deletion an invite falls back to the first channel (got "${await text(C, ".channel-title")}")`,
);

// ---- The setting is out of a plain member's reach: settings bounce
// them back to the space, and the server refuses them either way
// (internal/chat/spaces_test.go).
await B.goto(`${base}/s/${spaceId}/settings`, { waitUntil: "networkidle0" });
check(
  await waitFor(
    async () =>
      path(B) !== `/s/${spaceId}/settings` && (await B.$(SELECT)) === null,
  ),
  `a member asking for settings is sent back to the space (at ${path(B)})`,
);

await done();
