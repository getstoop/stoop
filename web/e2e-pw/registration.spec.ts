import type { Page } from "@playwright/test";
import { acceptDialog, expect, pastGate, reload, test } from "./lib";

const atPath = (p: Page, want: string, message: string) =>
  expect.poll(() => new URL(p.url()).pathname, { message }).toBe(want);

// Server-tab settings are one form: a select's new value only takes
// effect once Save is clicked, and "Saved." says the round trip is over.
const saveServer = async (p: Page) => {
  await p.locator(".setting-actions button.primary").click();
  await expect(p.locator(".setting-actions .hint")).toHaveText("Saved.");
};

// Who may create an account (invite, open, closed), who may create
// spaces, and the admin's account list — deactivate, reactivate, and the
// row that is the admin's own.
// Ported from web/e2e/registration.mjs (STOOP-238). Deliberately unseeded:
// the registration policy is the subject, and the wizard below is the
// only way an empty instance gets its admin.
test("registration policy, invites and accounts", async ({ browser }) => {
  const suffix = String(Date.now() % 1000000);
  const password = "correct horse battery";
  const codeField = (p: Page) =>
    p.locator('input[placeholder="From the person who invited you"]');

  // Admin sets up; grabs the invite link.
  const A = await (await browser.newContext()).newPage();
  await A.goto("/");
  await expect(A, "expected a fresh instance").toHaveURL(/\/setup$/);
  await A.locator('input[autocomplete="username"]').fill(`ada${suffix}`);
  await A.locator('input[type="password"]').fill(password);
  await A.locator('button[type="submit"]').click();
  await A.locator('input[placeholder="The Porch"]').fill("Stoop HQ");
  await A.locator('button[type="submit"]').click();
  // Setup step 3 (reaching your server) is skippable.
  await A.locator("button.reach-continue").click();
  const link = await A.locator(".link-box code").innerText();
  await A.getByRole("button", { name: "Go to your space" }).click();
  await expect(
    A.locator('a[title="Server admin"]'),
    "admin sees the gear pill",
  ).toBeVisible();

  // Default policy is invite: an anonymous visitor must supply a code.
  const B = await (await browser.newContext()).newPage();
  await B.goto("/login");
  await B.locator("button.link").click();
  await expect(
    codeField(B),
    "invite policy: create-account form asks for a code",
  ).toBeVisible();
  await B.locator('input[autocomplete="username"]').fill(`walkin${suffix}`);
  await B.locator('input[type="password"]').fill(password);
  await codeField(B).fill("nope1234ab");
  await B.locator('button[type="submit"]').click();
  await expect(
    B.locator("p.error"),
    "bad code rejected with a clear error",
  ).toHaveText("invite not found");

  // Via the link: code pre-filled and locked; the account lands in the space.
  await B.goto(link);
  await pastGate(B);
  await expect(codeField(B), "join link pre-fills the code").toHaveValue(
    /^[1-9A-HJ-NP-Za-km-z]{10}$/,
  );
  await expect(codeField(B), "join link locks the code").toHaveJSProperty(
    "readOnly",
    true,
  );
  await B.locator('input[autocomplete="username"]').fill(`bea${suffix}`);
  await B.locator('input[type="password"]').fill(password);
  await B.locator('button[type="submit"]').click();
  await expect(
    B.locator(".space-name"),
    "invited signup lands in the space",
  ).toHaveText("Stoop HQ");
  await expect(B, "on the space's own address").toHaveURL(/\/s\//);

  // Admin page: the account list holds real accounts only.
  await A.locator('a[title="Server admin"]').click();
  await atPath(A, "/admin", "gear opens /admin");
  await A.locator('.settings-tab[data-tab="accounts"]').click();
  const users = A.locator(".user-list");
  await expect(users, "the admin is listed").toContainText(`@ada${suffix}`);
  await expect(users, "the invited account is listed").toContainText(
    `@bea${suffix}`,
  );
  await expect(
    users,
    "the rejected signup never became an account",
  ).not.toContainText(`@walkin${suffix}`);

  // The server's name is the tab's title everywhere, saved through the
  // same form as the policies, and still there after a reload.
  await A.locator('.settings-tab[data-tab="server"]').click();
  expect(await A.title(), "the tab has a title").not.toBe("");
  await A.locator("#instance-name").fill(`Stoop HQ ${suffix}`);
  await saveServer(A);
  await expect(A, "saved server name becomes the tab title").toHaveTitle(
    `Stoop HQ ${suffix}`,
  );
  await reload(A);
  await expect(A, "server name persists across reload").toHaveTitle(
    `Stoop HQ ${suffix}`,
  );

  // Open → anonymous signup works without a code.
  await A.locator('select[name="registration-policy"]').selectOption("1");
  await saveServer(A);
  const C = await (await browser.newContext()).newPage();
  await C.goto("/login");
  await C.locator("button.link").click();
  await C.getByRole("button", { name: "Create account" }).waitFor();
  await expect(codeField(C), "open policy: no code field").toHaveCount(0);
  await C.locator('input[autocomplete="username"]').fill(`cal${suffix}`);
  await C.locator('input[type="password"]').fill(password);
  await C.locator('button[type="submit"]').click();
  await atPath(C, "/", "open signup works and lands home");
  await C.locator(".space-pill.avatar").waitFor();
  await expect(
    C.locator('button[title="Create a space"]'),
    "member can't create spaces by default (no + pill)",
  ).toHaveCount(0);

  await A.locator('select[name="space-creation"]').selectOption("2");
  await saveServer(A);
  await reload(C);
  await expect(
    C.locator('button[title="Create a space"]'),
    "after admin opens space creation, member sees the + pill",
  ).toBeVisible();
  await A.locator('select[name="space-creation"]').selectOption("1");
  await saveServer(A);

  // Closed → no create-account option at all.
  await A.locator('select[name="registration-policy"]').selectOption("3");
  await saveServer(A);
  const D = await (await browser.newContext()).newPage();
  await D.goto("/login");
  await expect(D.locator("#root"), "closed policy says so").toContainText(
    "isn't accepting new accounts",
  );
  await expect(
    D.locator("button.link"),
    "closed policy hides create-account",
  ).toHaveCount(0);

  // Policy survives a reload of the admin (persisted), then back to invite.
  await reload(A);
  await expect(
    A.locator('select[name="registration-policy"]'),
    "policy persisted across reload",
  ).toHaveValue("3");
  await A.locator('select[name="registration-policy"]').selectOption("2");
  await saveServer(A);

  // Deactivate cal: C's session dies; reactivate: can log in again.
  await A.locator('.settings-tab[data-tab="accounts"]').click();
  const calMenu = A.locator(`button[aria-label="Actions for @cal${suffix}"]`);
  const calRow = A.locator(".user-row", { hasText: `@cal${suffix}` });
  // The menu closes on any scroll, so scroll before the click rather than
  // with it.
  await calMenu.scrollIntoViewIfNeeded();
  await calMenu.click();
  await A.getByRole("menuitem", { name: "Deactivate" }).click();
  await acceptDialog(A);
  await reload(C);
  await atPath(C, "/login", "deactivated user bounced to login");
  await C.locator('input[autocomplete="username"]').fill(`cal${suffix}`);
  await C.locator('input[type="password"]').fill(password);
  await C.locator('button[type="submit"]').click();
  await expect(
    C.locator("p.error"),
    "deactivated login refused with a clear error",
  ).toContainText("deactivated");

  await reload(A);
  await expect(
    calRow,
    "admin list marks the account deactivated",
  ).toContainText("deactivated");
  await calMenu.scrollIntoViewIfNeeded();
  await calMenu.click();
  await A.getByRole("menuitem", { name: "Reactivate" }).click();
  await expect(calRow).not.toContainText("deactivated");
  await C.locator('button[type="submit"]').click();
  await expect(C, "reactivated user can log in").not.toHaveURL(/\/login/);

  // An admin's own row offers no actions.
  await expect(
    A.locator(".user-list"),
    "own row shows 'you' instead of actions",
  ).toContainText("you");
});
