// Direct messages (STOOP-65): open one from a member's card, talk both
// ways in real time, see the DMs pill light up, survive a reload, and
// stay closed to people who aren't in it.
import {
  BASE as base,
  gotoShared,
  harness,
  reloadShared,
  sleep,
  waitFor,
} from "./lib.mjs";

const { check, newPage, done } = await harness({ dialogs: true });
const suffix = String(Date.now() % 1000000);

// A sets up the instance; B and C join via the invite link.
const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("expected a fresh instance");
const aName = `ada${suffix}`;
await A.type('input[autocomplete="username"]', aName);
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

const joinAs = async (tag, name) => {
  const p = await newPage(tag);
  await gotoShared(p, link);
  await sleep(300);
  await p.type('input[autocomplete="username"]', name);
  await p.type('input[type="password"]', "correct horse battery");
  await p.click('button[type="submit"]');
  await sleep(2500);
  return p;
};
const bName = `bea${suffix}`;
const B = await joinAs("B", bName);
const cName = `cal${suffix}`;
const C = await joinAs("C", cName);
await sleep(800);

// Open a DM from B's row in the member list.
const clickMember = async (page, name) => {
  for (const row of await page.$$(".member-row")) {
    const text = await row.evaluate((e) => e.textContent);
    if (text.includes(name)) {
      await row.click();
      return;
    }
  }
  throw new Error(`no member row for ${name}`);
};
await clickMember(A, bName);
check(
  await waitFor(async () => (await A.$(".user-card .message-button")) !== null),
  "member card offers Message",
);
await A.click(".user-card .message-button");
await sleep(1500);
const dmPath = new URL(A.url()).pathname;
check(dmPath.startsWith("/dm/"), `Message opens the conversation (${dmPath})`);
check(
  (await A.$eval(".dm-title", (e) => e.textContent)).includes(bName),
  "header names the other person",
);
check(
  (await A.$eval(".composer textarea", (e) => e.placeholder)) ===
    `Message @${bName}`,
  "composer placeholder addresses them",
);
check(
  (await A.$eval(".history-head", (e) => e.textContent)).includes(
    "conversation with",
  ),
  "history head is DM wording",
);
check(
  (await A.$$(".dm-link")).length === 1,
  "the DM list has the one conversation",
);

// A talks (twice); B gets one alert for the conversation, not one per
// message, and reads it live.
await A.type(".composer textarea", "hello bea");
await A.keyboard.press("Enter");
await sleep(700);
await A.type(".composer textarea", "you there?");
await A.keyboard.press("Enter");
check(
  await waitFor(
    async () =>
      (await B.$eval(".space-pill.dms .pill-badge", (e) => e.textContent).catch(
        () => "",
      )) === "1",
  ),
  "B's DMs pill shows one alert for the conversation",
);
check(
  await waitFor(
    async () => (await B.$(".space-pill.activity .pill-dot")) !== null,
  ),
  "B's activity pill is dotted after two messages",
);
check(
  (await B.$$(".channel-link")).length === 1,
  "B's space channel list has no DM in it",
);
await B.click(".space-pill.dms");
check(
  await waitFor(() => new URL(B.url()).pathname === dmPath),
  "the DMs pill opens the most recent conversation",
);
check(
  await waitFor(async () =>
    (await B.$$eval(".message-content", (es) => es.map((e) => e.textContent)))
      .join("|")
      .includes("hello bea"),
  ),
  "B sees A's message",
);
// The read marker is a round trip plus a realtime event; wait for the
// badge to go rather than guessing how long that takes under load.
check(
  await waitFor(
    async () => (await B.$(".space-pill.dms .pill-badge")) === null,
  ),
  "reading the DM clears B's alert",
);
await B.type(".composer textarea", "hi ada");
await B.keyboard.press("Enter");
check(
  await waitFor(async () =>
    (await A.$$eval(".message-content", (es) => es.map((e) => e.textContent)))
      .join("|")
      .includes("hi ada"),
  ),
  "A sees B's reply live",
);
check(
  await waitFor(
    async () => (await A.$(".space-pill.activity .pill-dot")) === null,
  ),
  "A, reading the DM, gets no lingering alert",
);

// Reload keeps it.
await reloadShared(A, { waitUntil: "networkidle0" });
check(
  await waitFor(
    async () =>
      new URL(A.url()).pathname === dmPath &&
      (await A.$$eval(".message-content", (es) => es.length)) === 3,
  ),
  "the conversation survives a reload",
);

// C is not in it: the URL bounces to the DM list.
await gotoShared(C, `${base}${dmPath}`, { waitUntil: "networkidle0" });
check(
  await waitFor(() => new URL(C.url()).pathname === "/dm"),
  `an outsider is bounced off the DM (${new URL(C.url()).pathname})`,
);
check(
  await waitFor(async () => (await C.$(".dm-empty")) !== null),
  "…and sees the empty DM list",
);

// C opens their own DM with A; A's list now has two, newest first.
await C.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(1200);
await clickMember(C, aName);
await sleep(500);
await C.click(".user-card .message-button");
await sleep(1500);
await C.type(".composer textarea", "hey from cal");
await C.keyboard.press("Enter");
await sleep(1200);
const aList = await A.$$eval(".dm-link .channel-name", (es) =>
  es.map((e) => e.textContent),
);
check(
  aList.length === 2 && aList[0] === cName,
  `A's DM list: ${aList.join(", ")} (newest first)`,
);
check(
  (await A.$eval(".space-pill.dms .pill-badge", (e) => e.textContent)) === "1",
  "A is alerted to the new conversation",
);

await done();
