import type { Page } from "@playwright/test";
import {
  acceptDialog,
  channelLink,
  expect,
  pastGate,
  seed,
  signIn,
  test,
} from "./lib";

// Where a space puts someone who arrives without a channel of their own:
// the channel it chooses, the first-channel fallback when it has chosen
// none, and what happens once the chosen channel is deleted (STOOP-109).
// Ported from web/e2e/default-channel.mjs (STOOP-238).
const SELECT = 'select[name="default-channel"]';

test("the channel a space opens in", async ({ browser }) => {
  const { invite, password, space, suffix, tokens } = await seed({
    users: ["ada"],
    channels: ["general"],
    invite: true,
  });
  const spaceId = space.id;
  const newPage = async () => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    return context.newPage();
  };
  // The dropdown holds channel ids, so pick by the name a person reads.
  const options = (p: Page) => p.locator(`${SELECT} option`);
  const chosen = (p: Page) => p.locator(`${SELECT} option:checked`);
  const settings = async (p: Page) => {
    await p.goto(`/s/${spaceId}/settings?tab=channels`);
    await p.locator(SELECT).waitFor();
  };
  // B and C have no account yet: registering through the link is the
  // arrival this spec is about.
  const register = async (p: Page, username: string) => {
    await p.goto(invite.url);
    await pastGate(p);
    await p.locator('input[autocomplete="username"]').fill(username);
    await p.locator('input[type="password"]').fill(password);
    await p.locator('button[type="submit"]').click();
    await p.locator(".composer textarea").waitFor();
  };

  // ---- A lands in #general; B and C are not members until they arrive.
  const A = await newPage();
  await signIn(A, tokens.ada);
  await A.locator(".composer textarea").waitFor();

  // ---- A second text channel, and a voice channel that must stay out of
  // the choices: landing someone there would open their microphone.
  await A.locator(".channel-group-heading .channel-add:not(.voice)").click();
  await acceptDialog(A, "tools");
  await channelLink(A, "tools").waitFor();
  await A.locator(".channel-group-heading .channel-add.voice").click();
  await acceptDialog(A, "porch-swing");
  await channelLink(A, "porch-swing").waitFor();

  await settings(A);
  await expect(options(A).first(), "unset is the first option").toHaveText(
    "First channel",
  );
  await expect(
    options(A).filter({ hasText: "tools" }),
    "a text channel is on offer",
  ).toHaveCount(1);
  await expect(
    options(A).filter({ hasText: "porch-swing" }),
    "a voice channel is not",
  ).toHaveCount(0);
  await expect(
    chosen(A),
    "a space that has never chosen one shows the fallback",
  ).toHaveText("First channel");

  // ---- Choose #tools, and B lands there rather than in #general
  const saved = A.waitForResponse((r) => r.url().includes("/UpdateSpace"));
  await A.locator(SELECT).selectOption({ label: "# tools" });
  await saved;
  await settings(A);
  await expect(chosen(A), "the choice survives a reload").toHaveText("# tools");

  const B = await newPage();
  await register(B, `bea${suffix}`);
  await expect(
    B.locator(".channel-title"),
    "an invite lands a new member in the chosen channel",
  ).toHaveText("tools");

  // Opening the space with no channel in the URL goes the same way.
  await B.goto(`/s/${spaceId}`);
  await pastGate(B);
  await expect(
    B.locator(".channel-title"),
    "so does /s/{id} with nothing after it",
  ).toHaveText("tools");

  // ---- Delete the chosen channel. The space must not be left pointing at
  // something that is gone.
  await settings(A);
  await A.locator(".user-row", { hasText: "# tools" })
    .locator(".chip.danger")
    .click();
  await acceptDialog(A);
  await expect(
    chosen(A),
    "deleting the chosen channel returns the space to the fallback",
  ).toHaveText("First channel");
  await expect(
    options(A).filter({ hasText: "tools" }),
    "the deleted channel is no longer on offer",
  ).toHaveCount(0);

  // A member who was never told stays honest too: C arrives on the same
  // invite and lands in #general, not in a channel that no longer exists.
  const C = await newPage();
  await register(C, `casey${suffix}`);
  await expect(
    C.locator(".channel-title"),
    "after the deletion an invite falls back to the first channel",
  ).toHaveText("general");

  // ---- The setting is out of a plain member's reach: settings bounce
  // them back to the space, and the server refuses them either way
  // (internal/chat/spaces_test.go).
  await B.goto(`/s/${spaceId}/settings`);
  await expect(
    B,
    "a member asking for settings is sent back to the space",
  ).not.toHaveURL(new RegExp(`/s/${spaceId}/settings$`));
  await expect(B.locator(SELECT), "…and never reaches the setting").toHaveCount(
    0,
  );
});
