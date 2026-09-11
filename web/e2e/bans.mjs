// Bans and blocks (STOOP-82): a person can block another (no DMs either
// way, undo from the profile page); a manager can ban someone from a
// space, which removes them and refuses the invite link until they're
// unbanned from the space's settings.
import {
  acceptDialog,
  BASE as base,
  dialog,
  dismissDialog,
  gotoShared,
  harness,
  seed,
  signIn,
  sleep,
  spaceMenu,
  waitFor,
} from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const { invite, suffix, tokens } = await seed({
  users: ["ada", "bea", "cal"],
  channels: ["general"],
  invite: true,
});
const path = (p) => new URL(p.url()).pathname;

// A, B and C are all members; the ban has to turn the invite link away.
const aName = `ada${suffix}`;
const bName = `bea${suffix}`;
const cName = `cal${suffix}`;
const A = await newPage("A");
await signIn(A, tokens.ada);
await A.waitForSelector(".composer textarea", { timeout: 8000 });
const spaceUrl = A.url();
const B = await newPage("B");
await signIn(B, tokens.bea);
await B.waitForSelector(".composer textarea", { timeout: 8000 });
const C = await newPage("C");
await signIn(C, tokens.cal);
await C.waitForSelector(".composer textarea", { timeout: 8000 });

const openCard = async (page, name) => {
  for (const row of await page.$$(".member-row")) {
    const text = await row.evaluate((e) => e.textContent);
    if (text.includes(name)) {
      await row.click();
      await sleep(600);
      return;
    }
  }
  throw new Error(`no member row for ${name}`);
};
const cardText = (page, sel) =>
  page.$eval(`.user-card ${sel}`, (e) => e.textContent);

// --- Blocking ---
await openCard(A, bName);
check((await cardText(A, ".block-button")) === "Block", "card offers Block");
await A.click(".user-card .block-button");
await acceptDialog(A);
check(
  await waitFor(async () => (await cardText(A, ".block-button")) === "Unblock"),
  "after confirming, the chip reads Unblock",
);
await A.keyboard.press("Escape");

// The blocked side can't open a conversation.
await openCard(B, aName);
await B.click(".user-card .message-button");
const refused = await dialog(B);
await dismissDialog(B);
check(
  !path(B).startsWith("/dm/") && /can't message/.test(refused.text),
  `blocked person's Message is refused (${refused.text})`,
);
await B.keyboard.press("Escape");

// Undo from the profile page.
await A.goto(`${base}/profile?tab=security`, {
  waitUntil: "networkidle0",
});
await sleep(800);
check(
  (await A.$eval(".blocked-section", (e) => e.textContent)).includes(bName),
  "profile lists the blocked person",
);
await A.click(".blocked-section .chip");
check(
  await waitFor(async () => (await A.$(".blocked-section")) === null),
  "unblocking empties the section",
);
await openCard(B, aName);
await B.click(".user-card .message-button");
check(
  await waitFor(() => path(B).startsWith("/dm/")),
  `after unblock, Message opens a DM (${path(B)})`,
);

// --- Banning (from Space settings → Members) ---
await gotoShared(A, spaceUrl, { waitUntil: "networkidle0" });
await sleep(800);
await openCard(A, cName);
check(
  (await A.$(".user-card .ban-button")) === null,
  "the profile card carries no Ban button",
);
await A.keyboard.press("Escape");
await sleep(200);
await spaceMenu(A, "Space settings");
await sleep(800);
await A.click('.settings-tab[data-tab="members"]');
await sleep(600);
const rowBtn = async (p, rowText, label) => {
  for (const row of await p.$$(".user-row")) {
    if (!(await p.evaluate((e) => e.innerText, row)).includes(rowText))
      continue;
    for (const b of await row.$$(".chip")) {
      if ((await p.evaluate((e) => e.textContent?.trim(), b)) === label)
        return b;
    }
  }
  return null;
};
await (await rowBtn(A, cName, "Ban")).click();
await acceptDialog(A);
check(
  await waitFor(async () => (await rowBtn(A, cName, "Kick")) === null),
  "banned person leaves the member list",
);
await A.click('.settings-tab[data-tab="banned"]');
await sleep(600);
check(
  (await A.$eval(".bans-section", (e) => e.textContent)).includes(cName),
  "settings lists the ban",
);
await gotoShared(C, invite.url);
check(
  await waitFor(async () =>
    (
      await C.$eval(".empty-state .error", (e) => e.textContent).catch(() => "")
    ).includes("can't rejoin"),
  ),
  "the invite link refuses them",
);

// Unban from settings; the same link works again.
await A.click(".bans-section .chip");
check(
  await waitFor(async () =>
    (await A.$eval(".bans-section", (e) => e.textContent)).includes(
      "Nobody is banned",
    ),
  ),
  "unbanning empties the list",
);
await gotoShared(C, invite.url);
check(
  await waitFor(() => path(C).startsWith("/s/")),
  `after unban, the link admits them (${path(C)})`,
);

await done();
