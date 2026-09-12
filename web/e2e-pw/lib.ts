import { test as base, expect, type Page } from "@playwright/test";
import pg from "pg";
// Seeding lives in .mjs with a .d.mts beside it: it was shared with the
// puppeteer suite, and there is no reason to churn it now that suite is
// gone.
import { BASE, joinSpace, SESSION_COOKIE, seed } from "../e2e/seed.mjs";

export { expect, joinSpace, seed };

const DB =
  process.env.STOOP_E2E_DATABASE_URL ??
  "postgres://stoop:stoop@localhost:5440/stoop?sslmode=disable";

// Registration only
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

// Every test gets a fresh instance without saying so, and leaves no pages
// behind.
//
// The closing matters more than it looks. Specs make their own contexts
// off the `browser` fixture, which Playwright keeps until the browser
// itself closes, so without this every page a spec opened stays open for
// the rest of the run. Browsers throttle background pages: requestAnimationFrame
// stalls, which stops the speaking ring in voice from ever being drawn,
// and only one page can be frontmost, which read-marking gates on. Both
// showed up as specs that passed alone and failed in the suite.
export const test = base.extend<{ fresh: undefined }>({
  fresh: [
    async ({ browser }, use) => {
      await resetDb();
      await use(undefined);
      await Promise.all(browser.contexts().map((c) => c.close()));
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

// Read-marking gates on hasAttention() — visible *and* focused — so any
// assertion about a badge clearing depends on which page is frontmost.
// bringToFront() only *asks*: each page here is its own browser context,
// which is its own window, and document.hasFocus() can lag the request or
// never follow it. Waiting on the thing the app actually reads turns an
// invisible precondition into one that either holds or names itself.
export async function focus(page: Page) {
  await page.bringToFront();
  await expect
    .poll(() => page.evaluate(() => document.hasFocus()), {
      message: "the page has focus, which read-marking gates on",
    })
    .toBe(true);
  // And tell the app focus came back. useMarkChannelRead and useAutoRead
  // re-check on the window's focus event, which a real window manager
  // fires when you click a window — but bringToFront() between two
  // headless contexts does not always deliver one, so the page can hold
  // focus while nothing has re-run. Dispatching it is emulating the
  // window manager, not faking the assertion: hasFocus() above is already
  // true, so the handler makes the same decision it would have made.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
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
