import type { Page } from "@playwright/test";
import {
  acceptDialog,
  expect,
  focus,
  hasVoice,
  seed,
  signIn,
  test,
} from "./lib";

// Push to talk end to end: turned on in account settings, kept across a
// reload, the mic opened by holding Ctrl+` and shut by letting go (as the
// other person in the call sees it), nothing opened while deafened, the
// mic shut when the window loses focus mid-hold, and a click on the mic
// button switching back to an open mic that stays shut. The hold logic
// itself (repeat, the release tail) is unit tested in
// src/api/pushToTalk.test.ts. Needs LiveKit, and skips itself without it.

// Whether the stage tile with this name carries the muted marker; null
// when there is no such tile.
const tileMuted = (p: Page, name: string) =>
  p.evaluate((want) => {
    const tiles = [...document.querySelectorAll(".stage-tiles .stage-tile")];
    const tile = tiles.find(
      (el) => el.querySelector(".tile-label")?.textContent === want,
    );
    return tile ? tile.querySelector(".tile-muted") !== null : null;
  }, name);

const expectTileMuted = (p: Page, name: string, want: boolean, why: string) =>
  expect
    .poll(() => tileMuted(p, name), { message: why, timeout: 8_000 })
    .toBe(want);

const hold = async (p: Page) => {
  await p.keyboard.down("Control");
  await p.keyboard.down("Backquote");
};
const letGo = async (p: Page) => {
  await p.keyboard.up("Backquote");
  await p.keyboard.up("Control");
};

test("push to talk", async ({ browser, request }) => {
  test.skip(
    !(await hasVoice(request)),
    "no LiveKit on this instance (make dev-services)",
  );
  test.setTimeout(120_000);

  const { suffix, tokens } = await seed();
  const ada = `ada${suffix}`;
  const bar = (p: Page) => p.locator(".voice-bar strong");

  const ctxA = await browser.newContext({ permissions: ["microphone"] });
  const A = await ctxA.newPage();
  await signIn(A, tokens.ada, "/profile?tab=voice");
  const ptt = A.locator("#push-to-talk");
  await expect(ptt, "push to talk is off by default").not.toBeChecked();
  await ptt.check();

  // Kept on this device: still on after a fresh load.
  await A.goto("/profile?tab=voice");
  await expect(
    A.locator("#push-to-talk"),
    "push to talk survives a reload",
  ).toBeChecked();

  await A.goto("/");
  await A.locator(".channel-add.voice").click();
  await acceptDialog(A, "lounge");
  await A.locator(".voice-channel .channel-link.voice").click();
  await expect(bar(A), "A connects to voice").toHaveText("Voice connected", {
    timeout: 15_000,
  });
  const mic = A.locator('.voice-bar [aria-label="Push to talk"]');
  await expect(mic, "the mic button says push to talk").toHaveClass(/\bon\b/);

  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const B = await ctxB.newPage();
  await signIn(B, tokens.bea);
  await B.locator(".voice-channel .channel-link.voice").click();
  await expect(bar(B), "B connects to voice").toHaveText("Voice connected", {
    timeout: 15_000,
  });
  await expectTileMuted(B, ada, true, "A arrives shut");

  // Hold to talk, let go to stop.
  await focus(A);
  await hold(A);
  await expect(mic, "the mic button lights while held").not.toHaveClass(
    /\bon\b/,
  );
  await expectTileMuted(B, ada, false, "B hears A while the key is held");
  await letGo(A);
  await expectTileMuted(B, ada, true, "letting go shuts A's mic");

  // Deafened, the key opens nothing (toggleMute would have undeafened).
  await A.locator('.voice-bar [aria-label="Deafen"]').click();
  await hold(A);
  await A.waitForTimeout(500);
  await expect(mic, "deafened, holding the key opens nothing").toHaveClass(
    /\bon\b/,
  );
  await expect(
    A.locator('.voice-bar [aria-label="Undeafen"]'),
    "…and does not undeafen",
  ).toHaveCount(1);
  await letGo(A);
  await A.locator('.voice-bar [aria-label="Undeafen"]').click();

  // The window losing focus mid-hold shuts the mic: the keyup may never
  // come.
  await hold(A);
  await expectTileMuted(B, ada, false, "A is talking again");
  await A.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expectTileMuted(B, ada, true, "losing focus shuts the mic mid-hold");
  await letGo(A);

  // A click on the mic button goes back to an open mic, still shut.
  await mic.click();
  await expect(
    A.locator('.voice-bar [aria-label="Unmute"]'),
    "clicking switches to an open mic, muted",
  ).toHaveAttribute("aria-pressed", "true");
  await hold(A);
  await A.waitForTimeout(500);
  await expectTileMuted(B, ada, true, "and the key no longer opens it");
  await letGo(A);

  await ctxA.close();
  await ctxB.close();
});
