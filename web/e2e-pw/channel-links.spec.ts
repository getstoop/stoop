import { COMPOSER, channelLink, expect, seed, signIn, test } from "./lib";

// #channel links: the picker offers the space's public channels, a name
// typed in full becomes a link, the link opens the channel, and a private
// channel is never offered or linked.
test("a #channel links to the channel", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general", "random"] });
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  const composer = A.locator(COMPOSER);
  await composer.waitFor();
  const picker = A.locator(".mention-picker");
  const title = A.locator(".channel-header .channel-title");
  // The picker opens and filters per keystroke, so the composer is typed
  // into, never filled.
  const type = (text: string) => composer.pressSequentially(text);
  const send = async () => {
    // Escape first, or Enter would pick from the picker instead of sending.
    await A.keyboard.press("Escape");
    await A.keyboard.press("Enter");
  };

  // ---- A private channel, made first so the picker could offer it.
  await A.locator(".channel-group-heading .channel-add:not(.voice)").click();
  await A.getByLabel("Channel name").fill("captains");
  await A.getByRole("switch").check();
  await A.getByRole("button", { name: "Create" }).click();
  await expect(title).toHaveText("captains");
  await channelLink(A, "general").click();
  await expect(title).toHaveText("general");

  // ---- Picked from the picker, and typed in full.
  await type("see #ran");
  await expect(picker).toHaveAttribute("aria-label", "Link a channel");
  await expect(picker.locator(".member-name")).toHaveText(["random"]);
  await A.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await type("or #general");
  await send();

  const sent = A.locator(".message-content", { hasText: "see" }).last();
  const pills = sent.locator("a.channel-pill");
  await expect(pills, "both are links").toHaveText(["#random", "#general"]);

  // ---- A private channel is neither offered nor linked.
  await type("#capt");
  await expect(picker, "no private channel in the picker").toBeHidden();
  await type("ains is private");
  await send();
  const secret = A.locator(".message-content", {
    hasText: "is private",
  }).last();
  await expect(secret).toHaveText("#captains is private");
  await expect(secret.locator(".channel-pill")).toHaveCount(0);

  // ---- The link opens its channel.
  await pills.first().click();
  await expect(title).toHaveText("random");
  await expect(A).toHaveURL(/\/s\/[^/]+\/c\/[^/?]+$/);
});
