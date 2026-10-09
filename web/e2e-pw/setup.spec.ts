import { expect, menuItems, pastGate, reload, say, test } from "./lib";

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
    "runs the server",
  );
  await expect(card, "step 1 is the account step").toContainText(
    /Step 1 of [67]/,
  );

  await A.locator('input[autocomplete="username"]').fill(`ada${suffix}`);
  await A.locator('input[type="password"]').fill("short");
  await A.locator('button[type="submit"]').click();
  await expect(
    card.locator(".field-error"),
    "a short password is refused beside the field",
  ).toHaveText("At least 8 characters.");
  await expect(card, "and the wizard stays on step 1").toContainText(
    /Step 1 of [67]/,
  );

  await A.locator('input[type="password"]').fill(password);
  await A.locator('button[type="submit"]').click();
  const current = A.locator(".setup-where strong");
  await expect(current, "advances to step 2").toHaveText(/Your space/);

  await A.getByLabel("Space name").fill("Stoop HQ");
  await A.locator('button[type="submit"]').click();
  await expect(current, "advances to remote access").toHaveText(
    /Remote access/,
  );

  // A reload part-way through picks up where it left off.
  await A.reload();
  await pastGate(A);
  await expect(A, "reload stays on /setup").toHaveURL(/\/setup$/);
  await expect(card, "the wizard welcomes the admin back").toContainText(
    "Welcome back",
  );
  await A.getByRole("button", { name: "Continue setup" }).click();
  await expect(current, "resumes at remote access").toHaveText(/Remote access/);
  for (const option of [
    "Only my home network",
    "My own reverse proxy",
    "Cloudflare Tunnel",
    "Tailscale",
  ]) {
    await expect(
      A.getByRole("radio", { name: new RegExp(option) }),
      `remote access offers ${option}`,
    ).toBeVisible();
  }

  // Every reachability step can be left for Server admin.
  await A.getByRole("button", { name: "Set up later" }).click();
  await expect(current, "advances to the address").toHaveText(/Address/);
  await A.getByRole("button", { name: "Continue" }).click();
  if (await card.getByText("Step 5 of 7").isVisible()) {
    await expect(current, "voice comes next when voice is on").toHaveText(
      /Voice and video/,
    );
    await A.getByRole("button", { name: "Set up later" }).click();
  }
  await expect(current, "email comes before the invite").toHaveText(/Email/);
  await A.getByRole("button", { name: "Continue" }).click();
  await expect(
    card.locator(".field-error"),
    "Continue with no host is refused beside the field",
  ).toHaveText("Enter a host, or set this up later.");
  await A.getByRole("button", { name: "Set up later" }).click();
  await expect(current, "advances to the invite").toHaveText(/Invite people/);
  const summary = card.locator(".setup-summary");
  await expect(summary, "the summary names the account").toContainText(
    `Account ada${suffix}`,
  );
  await expect(summary, "and the skipped remote access").toContainText(
    "Remote access skipped",
  );
  await expect(summary, "and the skipped email").toContainText("Email skipped");

  // On localhost the link only opens here; setting an address and coming
  // back shows the same invite, not a second one.
  const first = await A.locator(".link-box code").innerText();
  await expect(
    card.locator(".callout.warn"),
    "a localhost link is called out",
  ).toContainText("only opens on this machine");
  await A.getByRole("button", { name: "Set an address" }).click();
  await expect(current, "Set an address goes to the address").toHaveText(
    /Address/,
  );
  await A.getByRole("button", { name: "Continue" }).click();
  if ((await current.innerText()).includes("Voice")) {
    await A.getByRole("button", { name: "Set up later" }).click();
  }
  await expect(current, "then email").toHaveText(/Email/);
  // This time email is set up: Continue saves it on, nothing is sent.
  await A.getByLabel("Host", { exact: true }).fill("smtp.example.net");
  await A.getByLabel("From address", { exact: true }).fill("stoop@example.net");
  await A.getByRole("button", { name: "Continue" }).click();
  await expect(current, "back at the invite").toHaveText(/Invite people/);
  await expect(summary, "the summary names the email host").toContainText(
    "Email via smtp.example.net",
  );

  const link = await A.locator(".link-box code").innerText();
  expect(link, "the invite is minted once").toBe(first);
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

  await A.getByRole("button", { name: "Go to Stoop HQ" }).click();
  await expect(A, "Go to the space lands in #general").toHaveURL(
    /\/s\/[^/]+\/c\/[^/]+$/,
  );
  await expect(A.locator(".space-name"), "space rendered").toHaveText(
    "Stoop HQ",
  );

  // The space opens with the invite again and what was left for later,
  // until the admin dismisses it.
  const firstRun = A.locator(".first-run");
  await expect(
    firstRun.locator(".link-box code"),
    "the first-run card repeats the invite link",
  ).toHaveText(link);
  await expect(firstRun, "and lists what was skipped").toContainText(
    "Remote access skipped",
  );
  await firstRun.getByRole("button", { name: "Dismiss" }).click();
  await expect(firstRun, "dismissed").toHaveCount(0);
  await reload(A);
  await expect(A.locator(".first-run"), "and it stays dismissed").toHaveCount(
    0,
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
