import {
  BASE as base,
  gotoShared,
  harness,
  sleep,
  spaceMenu,
  spaceMenuItems,
  waitFor,
} from "./lib.mjs";

const { browser, check, wire, done } = await harness();
const suffix = String(Date.now() % 1000000);

const A = await (await browser.createBrowserContext()).newPage();
wire(A, "A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
check(
  new URL(A.url()).pathname === "/setup",
  `fresh instance: / lands on /setup (${new URL(A.url()).pathname})`,
);
const t1 = await A.$eval(".setup-card", (e) => e.innerText);
check(
  t1.includes("server admin") && t1.includes("1. Your account"),
  "step 1 explains the admin account",
);
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
check(
  await waitFor(async () =>
    (
      await A.$eval(".setup-steps .current", (e) => e.textContent).catch(
        () => "",
      )
    ).includes("Your space"),
  ),
  "advances to step 2",
);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
check(
  await waitFor(async () =>
    (
      await A.$eval(".setup-steps .current", (e) => e.textContent).catch(
        () => "",
      )
    ).includes("Reaching your server"),
  ),
  "advances to step 3 (reaching your server)",
);
check(
  await waitFor(
    async () =>
      (await A.$(".reach-address")) !== null &&
      (await A.$(".reach-proxies")) !== null &&
      (await A.$(".reach-cloudflare")) !== null &&
      (await A.$(".reach-tailscale")) !== null,
  ),
  "step 3 offers each hosting setting as its own section",
);
// Skippable: the same form lives on the admin page.
await A.click("button.reach-continue");
await sleep(800);
check(
  await waitFor(async () =>
    (
      await A.$eval(".setup-steps .current", (e) => e.textContent).catch(
        () => "",
      )
    ).includes("Invite people"),
  ),
  "advances to step 4",
);
await A.waitForSelector(".link-box code", { timeout: 3000 });
const link = await A.$eval(".link-box code", (e) => e.textContent);
const lu = new URL(link);
check(
  lu.origin === base &&
    /^\/join\/[1-9A-HJ-NP-Za-km-z]{10}$/.test(lu.pathname) &&
    lu.searchParams.get("space") === "Stoop HQ",
  `invite link minted: ${link}`,
);
await A.evaluate(() => {
  navigator.clipboard.writeText = (t) => {
    window.__copied = t;
    return Promise.resolve();
  };
});
await A.click(".link-box button");
await sleep(200);
check(
  await waitFor(async () => (await A.evaluate(() => window.__copied)) === link),
  "Copy button copies the link",
);
await A.click("button.primary");
await sleep(1500);
check(
  await waitFor(() => /^\/s\/[^/]+\/c\/[^/]+$/.test(new URL(A.url()).pathname)),
  `Go to your space lands in #general (${new URL(A.url()).pathname})`,
);
check(
  await waitFor(
    async () =>
      (await A.$eval(".space-name", (e) => e.textContent).catch(() => "")) ===
      "Stoop HQ",
  ),
  "space rendered",
);

// Admin sees the Invite chip and the invite from setup listed.
await spaceMenu(A, "Invite people");
await A.waitForSelector(".invite-row", { timeout: 3000 });
check(
  (await A.$eval(".invite-row .invite-meta", (e) => e.textContent)).includes(
    "0 uses",
  ),
  "setup invite listed in the modal",
);
await A.keyboard.press("Escape");

// Once set up: /setup bounces to /login, and / bounces to /login for a logged-out visitor.
const B = await (await browser.createBrowserContext()).newPage();
wire(B, "B");
await B.goto(`${base}/setup`, { waitUntil: "networkidle0" });
await sleep(300);
check(
  await waitFor(() => new URL(B.url()).pathname === "/login"),
  `/setup after setup → /login (${new URL(B.url()).pathname})`,
);
await B.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
check(
  await waitFor(() => new URL(B.url()).pathname === "/login"),
  `second visitor: / → /login (${new URL(B.url()).pathname})`,
);

// B follows the onboarding link, creates an account, lands in the space; A's message arrives live.
await gotoShared(B, link);
await sleep(300);
check(
  await waitFor(async () =>
    (
      await B.$eval(".invite-hero", (e) => e.innerText).catch(() => "")
    ).includes("Stoop HQ"),
  ),
  "invite link names the space",
);
await B.type('input[autocomplete="username"]', `friend${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);
check(
  await waitFor(
    async () =>
      (await B.$eval(".space-name", (e) => e.textContent).catch(() => "")) ===
      "Stoop HQ",
  ),
  `B lands in the space (${new URL(B.url()).pathname})`,
);
check(
  !(await spaceMenuItems(B)).includes("Invite people"),
  "a member is not offered Invite",
);
check((await B.$(".channel-add")) === null, "member does not see Add channel");
check((await A.$(".channel-add")) !== null, "owner sees Add channel");
await sleep(800);
await A.type(".composer textarea", `welcome ${suffix}`);
await A.keyboard.press("Enter");
await sleep(1200);
check(
  await waitFor(async () =>
    (await B.$eval(".message-list", (e) => e.innerText)).includes(
      `welcome ${suffix}`,
    ),
  ),
  "B receives A's message live",
);

await done();
