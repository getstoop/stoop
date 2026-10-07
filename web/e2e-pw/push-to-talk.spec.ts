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

// Push to talk end to end: turned on in account settings and kept across
// a reload; while muted, holding Ctrl+` unmutes (as the other person in
// the call sees it) and letting go mutes; while unmuted, the key does
// nothing, and a repeat of it never undoes a Mute clicked mid-hold.
// The hold itself (repeats, the release tail) is unit tested in
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

  const ctxB = await browser.newContext({ permissions: ["microphone"] });
  const B = await ctxB.newPage();
  await signIn(B, tokens.bea);
  await B.locator(".voice-channel .channel-link.voice").click();
  await expect(bar(B), "B connects to voice").toHaveText("Voice connected", {
    timeout: 15_000,
  });
  await expectTileMuted(B, ada, true, "A arrives muted");

  // Muted: hold to talk, let go to stop.
  await focus(A);
  await hold(A);
  await expect(
    A.locator('.voice-bar [aria-label="Mute"]'),
    "holding the key unmutes",
  ).toHaveCount(1);
  await expectTileMuted(B, ada, false, "B hears A while the key is held");
  await letGo(A);
  await expectTileMuted(B, ada, true, "letting go mutes A again");

  // Unmuted by hand: the key leaves the mic alone.
  await A.locator('.voice-bar [aria-label="Unmute"]').click();
  await expectTileMuted(B, ada, false, "A unmutes with the button");
  await hold(A);
  // Muting with the key still down, then the key repeating, must not
  // reopen the mic: only a fresh press starts a hold. Clicked from the
  // page, since a mouse click here would carry the held Ctrl (a right
  // click on macOS).
  await A.locator('.voice-bar [aria-label="Mute"]').evaluate((button) =>
    (button as HTMLButtonElement).click(),
  );
  await expect(
    A.locator('.voice-bar [aria-label="Unmute"]'),
    "Mute took, with the key still held",
  ).toHaveCount(1);
  await A.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "Backquote",
        key: "`",
        ctrlKey: true,
        repeat: true,
      }),
    ),
  );
  await A.waitForTimeout(500);
  await expectTileMuted(B, ada, true, "a repeating key does not undo Mute");
  await letGo(A);
  await A.locator('.voice-bar [aria-label="Unmute"]').click();
  await expectTileMuted(B, ada, false, "A unmutes with the button again");
  await hold(A);
  await letGo(A);
  await A.waitForTimeout(500);
  await expectTileMuted(B, ada, false, "the key does not mute an open mic");

  await ctxA.close();
  await ctxB.close();
});
