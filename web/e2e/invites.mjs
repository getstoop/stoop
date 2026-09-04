import puppeteer from "puppeteer-core";
import {
  acceptDialog,
  BASE as base,
  chromePath,
  dialog,
  dismissDialog,
  sleep,
  spaceMenu,
  spaceMenuItems,
} from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const wire = (page, tag) => {
  page.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("401"))
      console.log(`[${tag} console]`, m.text());
  });
};
const suffix = String(Date.now() % 1000000);

// ---- A: fresh instance → setup (admin + first space), then a second space via the rail
const ctxA = await browser.createBrowserContext();
const A = await ctxA.newPage();
wire(A, "A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(A.url()).pathname !== "/setup")
  throw new Error("flow.mjs needs a fresh instance");
await A.type('input[autocomplete="username"]', `webA${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', `First ${suffix}`);
await A.click('button[type="submit"]');
await sleep(1500);
// Setup step 3 (reaching your server) is skippable.
await A.click("button.reach-continue");
await sleep(800);
await A.click("button.primary");
await sleep(1200);
check(
  /^\/s\/[^/]+\/c\/[^/]+$/.test(new URL(A.url()).pathname),
  `A completes setup and lands in a space (${new URL(A.url()).pathname})`,
);

await A.click('button[title="Create a space"]');
await acceptDialog(A, `Stoop HQ ${suffix}`);
await sleep(1500);
check(
  /^\/s\/[^/]+\/c\/[^/]+$/.test(new URL(A.url()).pathname),
  `A navigated into new space (${new URL(A.url()).pathname})`,
);
const spaceId = new URL(A.url()).pathname.split("/")[2];

await spaceMenu(A, "Invite people");
await A.waitForSelector(".modal", { timeout: 3000 });
check(true, "invite modal opens");
// The list fetches after the modal mounts; wait for it rather than
// sampling "Loading…".
await A.waitForFunction(
  () =>
    document
      .querySelector(".invite-list")
      ?.textContent?.includes("No invites yet"),
  { timeout: 3000 },
).catch(() => {});
check(
  (await A.$eval(".invite-list", (e) => e.innerText)).includes(
    "No invites yet",
  ),
  "modal shows empty list",
);
const roleOpts = await A.$$eval(
  "select[title], .invite-form label:nth-of-type(3) select option",
  (o) => o.map((e) => e.textContent),
);
check(
  roleOpts.includes("member") && roleOpts.includes("admin"),
  `owner can choose joins-as (${roleOpts})`,
);
await A.select(".invite-form label:nth-of-type(1) select", "86400");
await A.type('.invite-form input[type="number"]', "5");
await A.click('.invite-form button[type="submit"]');
await A.waitForSelector(".invite-row", { timeout: 3000 });
const code = await A.$eval(".invite-row .invite-code", (e) => e.textContent);
const meta = await A.$eval(".invite-row .invite-meta", (e) => e.textContent);
check(
  /^[1-9A-HJ-NP-Za-km-z]{10}$/.test(code),
  `invite created with base58 code ${code}`,
);
check(
  meta.startsWith("joins as member · 0/5 uses") && meta.includes("expires"),
  `invite meta: ${meta}`,
);
check(
  (await A.$(".invite-row .chip.danger")) !== null,
  "creator sees Revoke button",
);
await A.evaluate(() => {
  navigator.clipboard.writeText = (t) => {
    window.__copied = t;
    return Promise.resolve();
  };
});
await A.click('button[title="Copy join link"]');
await sleep(300);
const copiedLink = await A.evaluate(() => window.__copied);
const cu = new URL(copiedLink);
check(
  cu.origin === base &&
    cu.pathname === `/join/${code}` &&
    cu.searchParams.get("space") === `Stoop HQ ${suffix}`,
  `Copy link yields ${copiedLink}`,
);
await A.keyboard.press("Escape");
await sleep(300);
check((await A.$(".modal")) === null, "Escape closes modal");

// ---- B: logged out, visit /join/<code> → login with redirect → lands in space
const ctxB = await browser.createBrowserContext();
const B = await ctxB.newPage();
wire(B, "B");
const link = `${base}/join/${code}?space=${encodeURIComponent(`Stoop HQ ${suffix}`)}`;
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(500);
const bUrl = new URL(B.url());
const rd = new URL(bUrl.searchParams.get("redirect") ?? "/", base);
check(
  bUrl.pathname === "/login" &&
    rd.pathname === `/join/${code}` &&
    rd.searchParams.get("space") === `Stoop HQ ${suffix}`,
  `logged-out /join bounces to login with redirect (${bUrl.pathname}${bUrl.search})`,
);
const bSub = await B.$eval(".invite-next", (e) => e.textContent);
const bHero = await B.$eval(".invite-hero", (e) => e.innerText);
const bBtn = await B.$eval('button[type="submit"]', (e) => e.textContent);
check(
  bSub.includes("Create an account to join") &&
    bHero.includes(`Stoop HQ ${suffix}`) &&
    bBtn === "Create account & join",
  `the landing names the space and the next step ("${bSub}" / "${bBtn}")`,
);
check(
  (
    await B.$$eval(".invite-choice button", (els) =>
      els.map((e) => e.dataset.mode),
    )
  ).join() === "register,login",
  "invite landing offers both paths: new and returning",
);
await B.click('.invite-choice button[data-mode="login"]');
check(
  (await B.$eval(".invite-next", (e) => e.textContent)).includes(
    "Log in to join",
  ) &&
    (await B.$eval('button[type="submit"]', (e) => e.textContent)) ===
      "Log in & join",
  "choosing 'I already have an account' keeps invite context",
);
// A bare link (no ?space=) still names the space: since STOOP-108 the
// landing asks the server what the code is for rather than trusting the
// hint in the link.
const Bare = await ctxB.newPage();
await Bare.goto(`${base}/join/${code}`, { waitUntil: "networkidle0" });
await sleep(600);
check(
  (await Bare.$eval(".invite-hero", (e) => e.innerText)).includes(
    `Stoop HQ ${suffix}`,
  ),
  "bare link names the space from the server's invite lookup",
);
await Bare.close();
await B.click('.invite-choice button[data-mode="register"]');
await B.type('input[autocomplete="username"]', `webB${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await sleep(2500);
check(
  (await B.evaluate(() => localStorage.getItem("stoop.hasAccount"))) === "1",
  "a successful login marks this browser as having an account",
);
check(
  new URL(B.url()).pathname.startsWith(`/s/${spaceId}`),
  `B lands in A's space after login (${new URL(B.url()).pathname})`,
);
check(
  (await B.$eval(".space-name", (e) => e.textContent)).includes("Stoop HQ"),
  "B sees the space name",
);

// ---- realtime: A sends, B receives
await sleep(1000); // let B's WS connect
const msg = `hi from A ${suffix}`;
await A.type(".composer textarea", msg);
await A.keyboard.press("Enter");
await sleep(1500);
check(
  (await B.$eval(".message-list", (e) => e.innerText)).includes(msg),
  "B sees A's message in realtime",
);
check(
  (await A.$eval(".message-list", (e) => e.innerText)).includes(msg),
  "A sees own message",
);

// ---- B is a plain member: no Invite chip; A's modal shows the use count. Rail join prompt with bad code errors clearly.
check(
  !(await spaceMenuItems(B)).includes("Invite people"),
  "member B is not offered Invite",
);
await spaceMenu(A, "Invite people");
await A.waitForSelector(".invite-row", { timeout: 3000 });
await sleep(600); // let the list refetch past the cached copy
check(
  (await A.$eval(".invite-row .invite-meta", (e) => e.textContent)).includes(
    "1/5 uses",
  ),
  "use count is 1/5 after B joined",
);
await A.keyboard.press("Escape");
await B.click('button[title="Join a space with an invite code"]');
await acceptDialog(B, "nope12345X");
const alertText = (await dialog(B)).text;
await dismissDialog(B);
check(alertText.includes("invite not found"), `bad code alert: "${alertText}"`);

// ---- A revokes; C visiting the link gets a clear error page
await spaceMenu(A, "Invite people");
await A.waitForSelector(".invite-row .chip.danger", { timeout: 3000 });
await A.click(".invite-row .chip.danger");
await sleep(800);
check(
  (await A.$eval(".invite-row", (e) => e.className)).includes("inactive") &&
    (
      await A.$eval(".invite-row .invite-meta", (e) => e.textContent)
    ).startsWith("Revoked"),
  "revoked invite shown as inactive",
);
const ctxC = await browser.createBrowserContext();
const C = await ctxC.newPage();
wire(C, "C");
await C.goto(`${base}/join/${code}`, { waitUntil: "networkidle0" });
await sleep(300);
await C.type('input[autocomplete="username"]', `webC${suffix}`);
await C.type('input[type="password"]', "correct horse battery");
await C.click('button[type="submit"]');
await sleep(1200);
const cErr = await C.$eval("p.error", (e) => e.textContent).catch(() => "");
check(
  cErr.includes("revoked"),
  `signup with a revoked link is refused: "${cErr}"`,
);

// ---- plain re-login of an existing account (the reported bug)
await A.keyboard.press("Escape");
await sleep(300);
await A.click(".space-pill.avatar");
await sleep(500);
// Log out is the last entry of the account nav; the rail pill still
// lands on Profile.
await A.click(".logout-link");
await sleep(800);
check(
  new URL(A.url()).pathname === "/login" && !new URL(A.url()).search,
  `logout → /login with no redirect (${A.url().replace(base, "")})`,
);
await A.type('input[autocomplete="username"]', `webA${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(2000);
check(
  new URL(A.url()).pathname.startsWith("/s/"),
  `existing-account login lands in a space (${new URL(A.url()).pathname})`,
);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
