import type { Page } from "@playwright/test";
import {
  acceptDialog,
  channelLink,
  expect,
  gotoShared,
  say,
  seed,
  signIn,
  test,
} from "./lib";

// A private channel through the app (STOOP-492): made with the Private
// switch, seen only by the people added to it, and run from its People
// panel. Who may read what is the server's rule and is tested there
// (internal/app/e2e_private_channels_test.go); this is the wiring.
test("a private channel and its people", async ({ browser }) => {
  const { suffix, tokens, space } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });
  const bea = `bea${suffix}`;
  const open = async (token: string) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, token);
    await page.locator(".composer textarea").waitFor();
    return page;
  };
  const A = await open(tokens.ada);
  const B = await open(tokens.bea);
  const C = await open(tokens.cal);
  const people = (page: Page) => page.locator(".people-row .member-name");
  const addPeople = async (name: string) => {
    await A.getByRole("button", { name: "Add people" }).click();
    await A.locator(".candidate-row", { hasText: name })
      .locator("input")
      .check();
    await A.locator(".modal .modal-actions .primary").click();
  };

  // ---- Made private: its maker lands in it, on its People panel.
  await A.locator(".channel-group-heading .channel-add:not(.voice)").click();
  await A.getByLabel("Channel name").fill("captains");
  await A.getByRole("switch").check();
  await A.getByRole("button", { name: "Create" }).click();
  await expect(A.locator(".channel-header .channel-title")).toHaveText(
    "captains",
  );
  await expect(
    A.locator(".channel-row", { hasText: "captains" }).locator(
      ".channel-hash.icon",
    ),
    "a lock in the sidebar",
  ).toBeVisible();
  await expect(people(A), "its maker is the first person in it").toHaveCount(1);
  await expect(A.locator(".people-button")).toHaveText("1");
  const address = A.url();

  // ---- Added: it appears for that person without a reload, and for
  // nobody else.
  await addPeople(bea);
  await expect(people(A)).toHaveCount(2);
  await expect(channelLink(B, "captains")).toBeVisible();
  await expect(channelLink(C, "captains")).toHaveCount(0);

  await say(A, "the flyer is nearly done");
  await channelLink(B, "captains").click();
  await expect(B.getByText("the flyer is nearly done")).toBeVisible();

  // ---- Someone outside it gets nothing at its address.
  await gotoShared(C, address);
  await expect(channelLink(C, "general")).toBeVisible();
  await expect(C.getByText("the flyer is nearly done")).toHaveCount(0);
  await expect(channelLink(C, "captains")).toHaveCount(0);

  // ---- A member's panel lists the people and offers only Leave.
  await B.locator(".people-button").click();
  await expect(people(B)).toHaveCount(2);
  await expect(B.getByRole("button", { name: "Add people" })).toHaveCount(0);
  await expect(B.locator(".people-remove")).toHaveCount(0);

  // ---- Removed: asked first, and the channel leaves their sidebar.
  await A.locator(".people-row", { hasText: bea })
    .locator(".people-remove")
    .click();
  await acceptDialog(A);
  await expect(people(A)).toHaveCount(1);
  await expect(channelLink(B, "captains")).toHaveCount(0);
  await expect(
    B.getByText("You are no longer in this channel."),
    "their open People panel says so",
  ).toBeVisible();

  // ---- Leaving: asked first, and the list the others see follows.
  await addPeople(bea);
  await expect(people(A)).toHaveCount(2);
  await channelLink(B, "captains").click();
  await B.getByRole("button", { name: "Leave channel" }).click();
  await acceptDialog(B);
  await expect(channelLink(B, "captains")).toHaveCount(0);
  await expect(people(A)).toHaveCount(1);

  // ---- Space settings lists it with its people, and no Join for
  // someone already in it.
  await gotoShared(A, `/s/${space.id}/settings?tab=channels`);
  const row = A.locator("tr", { hasText: "captains" });
  await expect(row).toContainText("1 person");
  await expect(A.locator("tr", { hasText: "general" })).toContainText(
    "Everyone",
  );
  await A.locator(".channel-tables .dt-box")
    .first()
    .evaluate((box) => {
      box.scrollLeft = box.scrollWidth;
    });
  await A.getByLabel("Actions for #captains").click();
  await expect(A.getByRole("menuitem", { name: "People" })).toBeVisible();
  await expect(A.getByRole("menuitem", { name: "Join as member" })).toHaveCount(
    0,
  );
  await expect(
    A.getByRole("menuitem", { name: "Make announcement channel" }),
    "a private channel can't be an announcement channel",
  ).toHaveCount(0);
});
