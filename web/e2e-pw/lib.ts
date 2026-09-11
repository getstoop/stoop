import { type Page, expect } from "@playwright/test";

const DIALOG = ".modal[data-dialog]";

// The app's own modal, not a native dialog: fill the field if the prompt
// has one, then press the action.
export async function acceptDialog(page: Page, answer?: string) {
  await expect(page.locator(DIALOG)).toBeVisible();
  if (answer !== undefined) {
    await page.locator(`${DIALOG} :where(input, textarea)`).fill(answer);
  }
  await page.locator(`${DIALOG} .modal-actions .primary`).click();
}

// Entering on a shared link can land on the gate that offers the desktop
// app; take the way past. Safe on a page with no gate.
export async function pastGate(page: Page) {
  const stay = page.locator(".open-in-app button");
  await expect(
    page
      .locator(".open-in-app button, .app-shell, .login-card, .centered")
      .first(),
  ).toBeVisible();
  if (await stay.count()) await stay.click();
}

export const channelLink = (page: Page, name: string) =>
  page.locator(".channel-link", { hasText: name });

export const say = async (page: Page, text: string) => {
  await page.locator(".composer textarea").fill(text);
  await page.keyboard.press("Enter");
};
