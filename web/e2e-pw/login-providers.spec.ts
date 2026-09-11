import { expect, test } from "./lib";

// Login providers: the admin tab saves an OIDC provider, the login page
// grows a "Continue with X" button, errors surface, and the profile shows
// Linked accounts. No IdP round trip here (that's covered by Go tests
// with a fake issuer); this drives the config and the surfaces.
// Ported from web/e2e/login-providers.mjs (STOOP-238). The subject is
// signing up, so setup is still driven through the UI.
test("configuring an OIDC login provider", async ({ browser }) => {
  const suffix = String(Date.now() % 1000000);
  const user = `ada${suffix}`;
  const password = "correct horse battery";

  const P = await (await browser.newContext()).newPage();
  await P.goto("/");
  await expect(P, "a fresh instance opens on setup").toHaveURL(/\/setup$/);
  await P.locator('input[autocomplete="username"]').fill(user);
  await P.locator('input[type="password"]').fill(password);
  await P.locator('button[type="submit"]').click();
  await P.locator('input[placeholder="The Porch"]').fill("Stoop HQ");
  await P.locator('button[type="submit"]').click();
  await P.locator("button.reach-continue").click();
  await P.locator("button.primary").click();
  await expect(P).toHaveURL(/\/s\/[^/]+\/c\/[^/]+$/);

  // ---- Admin: add a Google provider from the preset -----------------------
  await P.goto("/admin?tab=login");
  await expect(
    P.locator('a.settings-tab[data-tab="login"]'),
    "admin has a Login tab",
  ).toBeVisible();
  // No public URL is configured in dev: the tab says so up front.
  await expect(
    P.locator(".provider-warning"),
    "tab warns about the missing public URL",
  ).toContainText("public URL first");
  await P.locator("button[data-add-provider]").click();
  await P.locator('button[data-preset="Google"]').click();
  await expect(
    P.locator('input[name="provider-issuer"]'),
    "Google preset prefills the issuer",
  ).toHaveValue("https://accounts.google.com");
  await P.locator('input[name="provider-client-id"]').fill("client-123");
  await P.locator('input[name="provider-client-secret"]').fill(
    "hunter2hunter2",
  );
  await P.locator('button[form="provider-form"]').click();
  await expect(
    P.locator('[data-provider-row="google"]'),
    "provider appears in the list after saving",
  ).toBeVisible();
  await expect(
    P.locator(".provider-form"),
    "dialog closes after saving",
  ).toHaveCount(0);

  // Reload and reopen: the secret is write-only, the placeholder says one
  // is saved.
  await P.goto("/admin?tab=login");
  await P.locator('[data-provider-row="google"] button[data-edit]').click();
  await expect(
    P.locator('input[name="provider-client-secret"]'),
    "saved secret shows as kept, never echoed",
  ).toHaveAttribute("placeholder", /saved/);
  await P.keyboard.press("Escape");
  await expect(P.locator(".provider-form")).toHaveCount(0);

  // ---- Login page: the button appears, errors render ----------------------
  const Q = await (await browser.newContext()).newPage();
  await Q.goto("/login");
  const button = Q.locator('a[data-provider="google"]');
  await expect(button, "login page shows the provider button").toBeVisible();
  await expect(button, "button carries the display name").toHaveText(
    "Continue with Google",
  );
  await Q.goto("/login?error=provider_error");
  await expect(
    Q.locator("p.error"),
    "callback error codes render as text",
  ).toContainText("provider");

  // ---- Profile: Linked accounts card --------------------------------------
  await P.goto("/profile?tab=security");
  await expect(
    P.locator(".linked-accounts"),
    "profile shows Linked accounts",
  ).toContainText("Linked accounts");
  await expect(
    P.locator('.linked-accounts a[data-provider="google"]'),
    "profile offers Connect Google",
  ).toBeVisible();
});
