import type { Page } from "@playwright/test";
import { expect, joinSpace, seed, signIn, test } from "./lib";

// Presence: the online count in the members panel, the typing indicator,
// presence on the profile card, and @here reaching whoever is online at
// the time — and nobody who isn't.
// Ported from web/e2e/presence.mjs (STOOP-238).
test("who is online, who is typing, and who @here reaches", async ({
  browser,
}) => {
  // bea and cal exist but are outside the space: the member count has to
  // grow as each of them arrives through the invite.
  const { suffix, tokens, invite } = await seed({
    users: ["ada", "bea", "cal"],
    members: ["ada"],
    channels: ["general"],
    invite: true,
  });
  const beaName = `bea${suffix}`;
  const composer = (p: Page) => p.locator(".composer textarea");
  const heading = (p: Page) => p.locator(".members-heading");
  const typing = (p: Page) => p.locator(".typing-indicator");
  const onlineNames = (p: Page) => p.locator(".member-row.online .member-name");

  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await expect(heading(A), "A alone: 1/1 online").toContainText("1/1 online");

  // B joins: both sides show two online.
  const Bctx = await browser.newContext();
  const B = await Bctx.newPage();
  await joinSpace(tokens.bea, invite.code);
  await signIn(B, tokens.bea);
  await expect(composer(B)).toBeVisible();
  await expect(heading(A), "A sees B come online").toContainText("2/2 online");
  await expect(
    onlineNames(A).filter({ hasText: beaName }),
    "A sees B come online",
  ).toHaveCount(1);
  await expect(
    heading(B),
    "B's Ready snapshot lists both online",
  ).toContainText("2/2 online");

  // Typing indicator: B types → A sees it; it expires after B stops. The
  // indicator is driven per keystroke, so the composer is typed into.
  await composer(B).pressSequentially("thinking about it");
  await expect(typing(A), "A sees 'bea is typing…'").toHaveText(
    `${beaName} is typing…`,
  );
  // One look, not a retried one: the point is that B never sees it.
  expect(await typing(B).innerText(), "B doesn't see their own typing").toBe(
    "",
  );
  await expect(typing(A), "typing hint expires after silence").toHaveText("", {
    timeout: 15_000,
  });
  await composer(B).click({ clickCount: 3 });
  await B.keyboard.press("Backspace");

  // Profile card shows presence.
  await A.locator(".member-row.online").first().click();
  await expect(
    A.locator(".user-card"),
    "profile card says online",
  ).toContainText("online");
  await A.keyboard.press("Escape");

  // @here from the owner: picker offers it; B (online) is notified. A third
  // member who is offline is not.
  const Cctx = await browser.newContext();
  const C = await Cctx.newPage();
  await joinSpace(tokens.cal, invite.code);
  await signIn(C, tokens.cal);
  await expect(composer(C)).toBeVisible();
  // cal has to be counted online before the browser goes away, or "2/3"
  // could be a count that never saw them arrive at all.
  await heading(A).filter({ hasText: "3/3 online" }).waitFor();
  await Cctx.close();
  await expect(
    heading(A),
    "A sees cal offline after closing (2/3 online)",
  ).toContainText("2/3 online");

  await B.locator(".space-pill.avatar").click(); // B looks away so the alert isn't auto-read
  await composer(A).pressSequentially("@he");
  await expect(
    A.locator(".mention-picker"),
    "picker offers @here",
  ).toContainText("Everyone online right now");
  await A.keyboard.press("Enter");
  await composer(A).pressSequentially("standup in 5", { delay: 20 });
  await A.keyboard.press("Enter");
  await expect(
    B.locator(".activity .pill-dot"),
    "online member is notified by @here",
  ).toHaveCount(1);

  // cal logs back in: nothing waiting.
  const C2 = await (await browser.newContext()).newPage();
  await signIn(C2, tokens.cal);
  await expect(composer(C2)).toBeVisible();
  // A negative check with nothing to wait for: give the activity count the
  // same moment to land that the puppeteer spec did.
  await C2.waitForTimeout(1000);
  expect(
    await C2.locator(".activity .pill-dot").count(),
    "offline member was not notified by @here",
  ).toBe(0);

  // B closes: A sees B offline.
  await Bctx.close();
  await expect(
    onlineNames(A).filter({ hasText: beaName }),
    "A sees B go offline",
  ).toHaveCount(0);
});
