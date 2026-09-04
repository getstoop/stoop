// Login providers: the admin tab saves an OIDC provider, the login page
// grows a "Continue with X" button, errors surface, and the profile shows
// Linked accounts. No IdP round trip here (that's covered by Go tests
// with a fake issuer); this drives the config and the surfaces.
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep } from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const suffix = String(Date.now() % 1000000);
const user = `ada${suffix}`,
  pass = "correct horse battery";

const P = await (await browser.createBrowserContext()).newPage();
P.on("pageerror", (e) => {
  console.log("[pageerror]", e.message);
  fails++;
});
await P.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (new URL(P.url()).pathname === "/setup") {
  await P.type('input[autocomplete="username"]', user);
  await P.type('input[type="password"]', pass);
  await P.click('button[type="submit"]');
  await sleep(1500);
  await P.type('input[placeholder="The Porch"]', "Stoop HQ");
  await P.click('button[type="submit"]');
  await sleep(1500);
  await P.click("button.reach-continue");
  await sleep(800);
  await P.click("button.primary");
  await sleep(1500);
} else {
  await P.click("button.link");
  await P.type('input[autocomplete="username"]', user);
  await P.type('input[type="password"]', pass);
  await P.click('button[type="submit"]');
  await sleep(2000);
}

// ---- Admin: add a Google provider from the preset -----------------------
await P.goto(`${base}/admin?tab=login`, { waitUntil: "networkidle0" });
await sleep(500);
check(
  (await P.$('a.settings-tab[data-tab="login"]')) !== null,
  "admin has a Login tab",
);
// No public URL is configured in dev: the tab says so up front.
check(
  (await P.content()).includes("public URL first"),
  "tab warns about the missing public URL",
);
await P.click("button[data-add-provider]");
await sleep(300);
await P.click('button[data-preset="Google"]');
await sleep(200);
check(
  (await P.$eval('input[name="provider-issuer"]', (e) => e.value)) ===
    "https://accounts.google.com",
  "Google preset prefills the issuer",
);
await P.type('input[name="provider-client-id"]', "client-123");
await P.type('input[name="provider-client-secret"]', "hunter2hunter2");
await P.click('button[form="provider-form"]');
await sleep(800);
check(
  (await P.$('[data-provider-row="google"]')) !== null,
  "provider appears in the list after saving",
);
check((await P.$(".provider-form")) === null, "dialog closes after saving");

// Reload and reopen: the secret is write-only, the placeholder says one
// is saved.
await P.goto(`${base}/admin?tab=login`, { waitUntil: "networkidle0" });
await sleep(500);
await P.click('[data-provider-row="google"] button[data-edit]');
await sleep(300);
check(
  (
    await P.$eval('input[name="provider-client-secret"]', (e) => e.placeholder)
  ).includes("saved"),
  "saved secret shows as kept, never echoed",
);
await P.keyboard.press("Escape");
await sleep(200);

// ---- Login page: the button appears, errors render ----------------------
const Q = await (await browser.createBrowserContext()).newPage();
await Q.goto(`${base}/login`, { waitUntil: "networkidle0" });
await sleep(500);
check(
  (await Q.$('a[data-provider="google"]')) !== null,
  "login page shows the provider button",
);
check(
  (await Q.content()).includes("Continue with Google"),
  "button carries the display name",
);
await Q.goto(`${base}/login?error=provider_error`, {
  waitUntil: "networkidle0",
});
await sleep(300);
check(
  (await Q.$eval("p.error", (e) => e.textContent)).includes("provider"),
  "callback error codes render as text",
);

// ---- Profile: Linked accounts card --------------------------------------
await P.goto(`${base}/profile?tab=security`, {
  waitUntil: "networkidle0",
});
await sleep(500);
const profile = await P.content();
check(profile.includes("Linked accounts"), "profile shows Linked accounts");
check(
  (await P.$('.linked-accounts a[data-provider="google"]')) !== null,
  "profile offers Connect Google",
);

await browser.close();
process.exit(fails ? 1 : 0);
