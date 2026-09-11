import { expect, menuItems, pastGate, say, test } from "./lib";

declare global {
  interface Window {
    __copied?: string;
  }
}

// The space header's actions live behind its ⋮.

// First-run setup: the four-step wizard, the invite it mints, and the
// first person to arrive through that link.
// Ported from web/e2e/setup.mjs (STOOP-238). Deliberately unseeded — the
// signup flow is the subject, and a seeded user makes /setup unreachable.
test("the first-run wizard and the first invited member", async ({
  browser,
}) => {
  const suffix = String(Date.now() % 1000000);
  const password = "correct horse battery";
  const A = await (await browser.newContext()).newPage();

  await A.goto("/");
  await expect(A, "fresh instance: / lands on /setup").toHaveURL(/\/setup$/);
  const card = A.locator(".setup-card");
  await expect(card, "step 1 explains the admin account").toContainText(
    "server admin",
  );
  await expect(card, "step 1 is the account step").toContainText(
    "1. Your account",
  );

  await A.locator('input[autocomplete="username"]').fill(`ada${suffix}`);
  await A.locator('input[type="password"]').fill(password);
  await A.locator('button[type="submit"]').click();
  const current = A.locator(".setup-steps .current");
  await expect(current, "advances to step 2").toHaveText(/Your space/);

  await A.locator('input[placeholder="The Porch"]').fill("Stoop HQ");
  await A.locator('button[type="submit"]').click();
  await expect(current, "advances to step 3 (reaching your server)").toHaveText(
    /Reaching your server/,
  );
  await expect(
    A.locator(".reach-address"),
    "step 3 offers the address",
  ).toBeVisible();
  await expect(
    A.locator(".reach-proxies"),
    "step 3 offers the proxies",
  ).toBeVisible();
  await expect(
    A.locator(".reach-cloudflare"),
    "step 3 offers Cloudflare",
  ).toBeVisible();
  await expect(
    A.locator(".reach-tailscale"),
    "step 3 offers Tailscale",
  ).toBeVisible();

  // Skippable: the same form lives on the admin page.
  await A.locator("button.reach-continue").click();
  await expect(current, "advances to step 4").toHaveText(/Invite people/);

  const link = await A.locator(".link-box code").innerText();
  const minted = new URL(link);
  expect(minted.origin, "the invite link points at this server").toBe(
    new URL(A.url()).origin,
  );
  expect(minted.pathname, "the invite link carries a join code").toMatch(
    /^\/join\/[1-9A-HJ-NP-Za-km-z]{10}$/,
  );
  expect(
    minted.searchParams.get("space"),
    "the invite link names the space",
  ).toBe("Stoop HQ");

  await A.evaluate(() => {
    navigator.clipboard.writeText = (t: string) => {
      window.__copied = t;
      return Promise.resolve();
    };
  });
  await A.locator(".link-box button").click();
  await expect
    .poll(() => A.evaluate(() => window.__copied), {
      message: "Copy button copies the link",
    })
    .toBe(link);

  await A.getByRole("button", { name: "Go to your space" }).click();
  await expect(A, "Go to your space lands in #general").toHaveURL(
    /\/s\/[^/]+\/c\/[^/]+$/,
  );
  await expect(A.locator(".space-name"), "space rendered").toHaveText(
    "Stoop HQ",
  );

  // Admin sees the Invite chip and the invite from setup listed.
  await A.locator(".sidebar-header .dots-menu-button").click();
  await A.getByRole("menuitem", { name: "Invite people" }).click();
  await expect(
    A.locator(".invite-row .invite-meta"),
    "setup invite listed in the modal",
  ).toContainText("0 uses");
  await A.keyboard.press("Escape");

  // Once set up: /setup bounces to /login, and so does / for a visitor.
  const B = await (await browser.newContext()).newPage();
  await B.goto("/setup");
  await expect(B, "/setup after setup → /login").toHaveURL(/\/login/);
  await B.goto("/");
  await expect(B, "second visitor: / → /login").toHaveURL(/\/login/);

  // B follows the onboarding link, creates an account, lands in the
  // space; A's message arrives live.
  await B.goto(link);
  await pastGate(B);
  await expect(
    B.locator(".invite-hero"),
    "invite link names the space",
  ).toContainText("Stoop HQ");
  await B.locator('input[autocomplete="username"]').fill(`friend${suffix}`);
  await B.locator('input[type="password"]').fill(password);
  await B.locator('button[type="submit"]').click();
  await expect(B.locator(".space-name"), "B lands in the space").toHaveText(
    "Stoop HQ",
  );
  await expect
    .poll(() => menuItems(B), { message: "a member is not offered Invite" })
    .not.toContain("Invite people");
  await expect(
    B.locator(".channel-add"),
    "member does not see Add channel",
  ).toHaveCount(0);
  await expect(
    A.locator(".channel-add").first(),
    "owner sees Add channel",
  ).toBeVisible();

  await say(A, `welcome ${suffix}`);
  await expect(
    B.locator(".message-list"),
    "B receives A's message live",
  ).toContainText(`welcome ${suffix}`);
});
