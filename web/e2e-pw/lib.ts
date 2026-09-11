import { test as base, expect, type Page } from "@playwright/test";
import pg from "pg";
// One seeding implementation, shared with the puppeteer suite, so the two
// can never drift on what a seeded world looks like.
import { BASE, joinSpace, SESSION_COOKIE, seed } from "../e2e/seed.mjs";

export { expect, joinSpace, seed };

const DB =
  process.env.STOOP_E2E_DATABASE_URL ??
  "postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable";

// The same reset web/e2e/run.mjs does between specs. Registration only
// bootstraps an admin on an instance with no users, so a spec that seeds
// has to start from an empty one.
async function resetDb() {
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  try {
    await client.query("TRUNCATE users CASCADE");
    await client.query("DELETE FROM instance_settings");
  } finally {
    await client.end();
  }
}

// Every test gets a fresh instance without saying so.
export const test = base.extend<{ fresh: undefined }>({
  fresh: [
    async ({ page: _page }, use) => {
      await resetDb();
      await use(undefined);
    },
    { auto: true },
  ],
});

// Puts a page straight into the app. The session token doubles as the
// cookie value, so there is no login form to drive.
export async function signIn(page: Page, token: string, path = "/") {
  await page
    .context()
    .addCookies([{ name: SESSION_COOKIE, value: token, url: BASE }]);
  await page.goto(path);
}

// Entering on a shared link — an invite, a space, a channel, a message —
// stops on the gate that offers the desktop app. Take the way past.
// Safe on a page that has no gate: it costs one locator check.
export async function pastGate(page: Page) {
  // Wait for the first paint before deciding: asking for the gate button
  // straight after a goto races the React mount and walks past a gate
  // that had not rendered yet.
  await page
    .locator(".open-in-app button, .app-shell, .login-card, .centered")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
  const stay = page.locator(".open-in-app button");
  if (await stay.count()) await stay.click();
}

// reload() on a channel URL meets the gate, so always come back through it.
export async function reload(page: Page) {
  await page.reload();
  await pastGate(page);
}

// Go to a shared link (invite, space, channel, message) and take the way
// past the desktop-app gate — the Playwright twin of gotoShared in
// web/e2e/lib.mjs.
export async function gotoShared(page: Page, url: string) {
  await page.goto(url);
  await pastGate(page);
}

// The space's kebab menu. menuItems reads its labels and closes it again,
// which is how specs assert what a role is offered; spaceMenu picks one.
export async function menuItems(page: Page) {
  await page.locator(".sidebar-header .dots-menu-button").click();
  const items = page.getByRole("menuitem");
  await items.first().waitFor();
  const labels = (await items.allTextContents()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  await expect(page.locator(".dots-menu")).toHaveCount(0);
  return labels;
}

export async function spaceMenu(page: Page, label: string) {
  await page.locator(".sidebar-header .dots-menu-button").click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

export const channelLink = (page: Page, name: string) =>
  page.locator(".channel-link", { hasText: name });

export const say = async (page: Page, text: string) => {
  await page.locator(".composer textarea").fill(text);
  await page.keyboard.press("Enter");
};

const DIALOG = ".modal[data-dialog]";

// The app's own modal, not a native dialog.
export async function acceptDialog(page: Page, answer?: string) {
  await expect(page.locator(DIALOG)).toBeVisible();
  if (answer !== undefined) {
    await page.locator(`${DIALOG} :where(input, textarea)`).fill(answer);
  }
  await page.locator(`${DIALOG} .modal-actions .primary`).click();
}
