import type { Page } from "@playwright/test";
import { acceptDialog, expect, hasVoice, seed, signIn, test } from "./lib";

// A private voice channel through the app (STOOP-493): made with the
// Private switch, its call and who is in it seen only by its people, and
// removal ending the call for the person removed and nobody else. Who
// is told what is the gateway's rule and is tested there
// (internal/realtime/private_voice_test.go); this is the wiring. Needs a
// running LiveKit, and skips itself without one.
test("a private voice channel and its call", async ({ browser, request }) => {
  test.skip(
    !(await hasVoice(request)),
    "no LiveKit on this instance (make dev-services)",
  );
  test.setTimeout(180_000);
  const { suffix, tokens } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });
  const bea = `bea${suffix}`;
  const open = async (token: string) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, token);
    await page.locator(".composer .rich-editor-content").waitFor();
    return page;
  };
  const A = await open(tokens.ada);
  const B = await open(tokens.bea);
  const C = await open(tokens.cal);
  const den = (page: Page) =>
    page.locator(".voice-channel", { hasText: "den" });
  const inDen = (page: Page) => den(page).locator(".voice-participant");
  const connected = (page: Page) =>
    expect(page.locator(".voice-bar strong")).toHaveText("Voice connected", {
      timeout: 20_000,
    });
  const addBea = async () => {
    await A.getByRole("button", { name: "Add people" }).click();
    await A.locator(".candidate-row", { hasText: bea })
      .locator("input")
      .check();
    await A.locator(".modal .modal-actions .primary").click();
    await expect(A.locator(".people-row")).toHaveCount(2);
  };

  // ---- Made private: a lock, its People panel, and no change of page.
  const page = A.url();
  await A.locator(".channel-add.voice").click();
  await A.getByLabel("Voice channel name").fill("den");
  await A.getByRole("switch").check();
  await A.getByRole("button", { name: "Create" }).click();
  await expect(
    den(A).locator(".channel-hash.icon"),
    "a lock in the sidebar",
  ).toBeVisible();
  await expect(A.locator(".people-row")).toHaveCount(1);
  expect(A.url(), "a voice channel's page opens by joining it").toBe(page);

  // ---- Added: it appears for that person, and for nobody else.
  await addBea();
  await expect(den(B)).toBeVisible();
  await expect(C.locator(".voice-channel")).toHaveCount(0);

  // ---- The call: its people see who is in it; someone outside sees
  // nothing, on a page opened after it started too.
  await den(A).locator(".channel-link.voice").click();
  await connected(A);
  await expect(inDen(B), "bea sees ada in the call").toHaveCount(1);
  await den(B).locator(".channel-link.voice").click();
  await connected(B);
  await expect(inDen(A)).toHaveCount(2);
  const late = await open(tokens.cal);
  await expect(
    late.locator(".channel-link", { hasText: "general" }),
  ).toBeVisible();
  await expect(late.locator(".voice-participant")).toHaveCount(0);
  await expect(C.locator(".voice-participant")).toHaveCount(0);

  // ---- Removed in the call: out of it, and ada stays.
  await A.locator(".people-row", { hasText: bea })
    .locator(".people-remove")
    .click();
  await acceptDialog(A);
  await expect(den(B)).toHaveCount(0);
  await expect(B.locator(".voice-bar")).toHaveCount(0);
  await expect(inDen(A), "ada is still listed").toHaveCount(1);
  await connected(A);

  // ---- Added back while the call is on: who is in it arrives with it.
  await addBea();
  await expect(inDen(B)).toHaveCount(1);
});
