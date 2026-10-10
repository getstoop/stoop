import type { Page } from "@playwright/test";
import {
  acceptDialog,
  channelLink,
  expect,
  hasVoice,
  pastGate,
  seed,
  signIn,
  test,
} from "./lib";

// Where a space puts someone who arrives without a channel of their own:
// its default channel, which a space always has, which can be changed and
// which can't be deleted while it is the default (STOOP-109, STOOP-467).
// Ported from web/e2e/default-channel.mjs (STOOP-238).
const SELECT = 'select[name="default-channel"]';

test("the channel a space opens in", async ({ browser, request }) => {
  // A server without voice has no voice channel to keep out of the
  // choices.
  const voice = await hasVoice(request);
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
  if (voice) {
    await A.locator(".channel-group-heading .channel-add.voice").click();
    await acceptDialog(A, "porch-swing");
    await channelLink(A, "porch-swing").waitFor();
  }

  await settings(A);
  await expect(
    options(A).filter({ hasText: "First channel" }),
    "there is no unset choice",
  ).toHaveCount(0);
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
    "a new space's default is its first channel",
  ).toHaveText("# general");

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

  // ---- The default channel can't be deleted until another is chosen.
  await settings(A);
  const rowMenu = (name: string) =>
    A.locator(".dt-row", { hasText: `# ${name}` }).locator(".dots-menu-button");
  await rowMenu("tools").click();
  await expect(
    A.getByRole("menuitem", { name: "Delete" }),
    "the default channel's Delete is off",
  ).toHaveAttribute("aria-disabled", "true");
  await A.keyboard.press("Escape");

  const moved = A.waitForResponse((r) => r.url().includes("/UpdateSpace"));
  await A.locator(SELECT).selectOption({ label: "# general" });
  await moved;
  await rowMenu("tools").click();
  await A.getByRole("menuitem", { name: "Delete" }).click();
  await acceptDialog(A);
  await expect(
    options(A).filter({ hasText: "tools" }),
    "the deleted channel is no longer on offer",
  ).toHaveCount(0);
  await expect(chosen(A), "the default stands").toHaveText("# general");

  // C arrives on the same invite and lands in the default.
  const C = await newPage();
  await register(C, `casey${suffix}`);
  await expect(
    C.locator(".channel-title"),
    "an invite lands a new member in the new default",
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
