// Presence status (STOOP-71): a chosen status shows on everyone else's
// dots and card, and survives a reload. Mutes live in mutes.mjs.
import {
  BASE as base,
  gotoShared,
  harness,
  reloadShared,
  sleep,
  waitFor,
} from "./lib.mjs";

const { check, newPage, done } = await harness();
const suffix = String(Date.now() % 1000000);

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
const B = await newPage("B");
await gotoShared(B, link);
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);

const dotFor = (page, name) =>
  page.evaluate((n) => {
    for (const r of document.querySelectorAll(".member-row")) {
      if (r.textContent.includes(n))
        return r.querySelector(".online-dot")?.className ?? "none";
    }
    return "row?";
  }, name);

check(
  await waitFor(async () => (await dotFor(B, aName)).includes("online")),
  "A starts online for B",
);

// A picks Do not disturb on the profile page.
await A.goto(`${base}/profile?tab=notifications`, {
  waitUntil: "networkidle0",
});
await sleep(500);
check(
  await waitFor(async () => (await A.$$(".status-option")).length === 3),
  "profile offers three statuses",
);
await A.click(".status-option:nth-child(3)");
await sleep(800);
check(
  await waitFor(async () =>
    (
      await A.$eval(".space-pill.avatar .online-dot", (e) => e.className).catch(
        () => "",
      )
    ).includes("dnd"),
  ),
  "A's own rail dot turns red",
);
check(
  await waitFor(async () => (await dotFor(B, aName)).includes("dnd")),
  "B sees A's dot go red live",
);
for (const r of await B.$$(".member-row")) {
  if ((await r.evaluate((e) => e.textContent)).includes(aName)) {
    await r.click();
    break;
  }
}
await sleep(500);
check(
  await waitFor(
    async () =>
      (await B.$eval(".user-card .presence", (e) => e.textContent).catch(
        () => "",
      )) === "do not disturb",
  ),
  "B's card for A says do not disturb",
);
await B.keyboard.press("Escape");

// The status survives a reload (per-browser preference, re-announced).
await reloadShared(A, { waitUntil: "networkidle0" });
await sleep(1200);
check(
  await waitFor(
    async () =>
      (
        await A.$eval(".status-option.active", (e) => e.textContent).catch(
          () => "",
        )
      ).includes("Do not disturb") && (await dotFor(B, aName)).includes("dnd"),
  ),
  "status persists across a reload",
);
await A.click(".status-option:nth-child(2)");
check(
  await waitFor(async () => (await dotFor(B, aName)).includes("away")),
  "Away shows amber for B",
);
await sleep(600);
await A.click(".status-option:nth-child(1)");
check(
  await waitFor(async () => (await dotFor(B, aName)).includes("online")),
  "back to Online",
);
await sleep(600);

await done();
