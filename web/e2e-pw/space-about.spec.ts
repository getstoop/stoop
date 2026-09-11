import { expect, pastGate, seed, signIn, test } from "./lib";

// A space says what it is: the description under its name and on an
// invite, and the welcome a new member lands on (STOOP-108).
// Ported from web/e2e/space-about.mjs (STOOP-238). Only ada is seeded:
// B registers through the invite link, because the stranger's view of the
// space is the subject.

const DESCRIPTION =
  "Neighbours between 4th and 7th. Tool library, stoop sales, and the group chat that finally replaced the group text.";
const WELCOME =
  "**Welcome to the block.** A few things worth knowing:\n- **#general** is for anything at all.\n- Be neighbourly.";

test("what a space says about itself", async ({ browser }) => {
  const { suffix, tokens, space } = await seed({
    users: ["ada"],
    channels: ["general"],
  });
  const spaceId = space.id;
  const viewport = { width: 1280, height: 900 };
  const A = await (await browser.newContext({ viewport })).newPage();

  // ---- A owns the space; nothing said about it yet
  await signIn(A, tokens.ada);
  await expect(A.locator(".composer textarea")).toBeVisible();
  await expect(
    A.locator(".space-desc"),
    "a space with nothing to say renders no description line",
  ).toHaveCount(0);

  await A.goto(`/s/${spaceId}/settings?tab=about`);
  const about = A.locator(".about-section");
  const fields = about.locator("textarea");
  await expect(
    fields,
    "About offers a description and a welcome field",
  ).toHaveCount(2);
  await fields.first().fill(DESCRIPTION);
  await fields.last().fill(WELCOME);
  await expect(about, "the description counts down from 200").toContainText(
    `${DESCRIPTION.length} / 200`,
  );

  // The preview renders the welcome the way a member will see it: the
  // asterisks become bold rather than staying on the page.
  await about.locator(".chip", { hasText: "Preview" }).click();
  const preview = A.locator(".about-preview");
  await expect(preview, "preview renders the markdown").toContainText(
    "Welcome to the block.",
  );
  await expect(preview, "and leaves no asterisks").not.toContainText("**");
  await about.locator(".chip", { hasText: "Write" }).click();

  await about.locator("button.primary").click();
  await expect(about, "About saves both fields").toContainText("Saved");

  // ---- The sidebar line: one line, cut off, and it opens the dialog
  await A.goto(`/s/${spaceId}`);
  await pastGate(A);
  // The welcome pane stands between the space and its first channel the
  // first time; step through it.
  await expect(
    A.locator(".space-welcome"),
    "the owner's own first visit lands on the welcome",
  ).toBeVisible();
  await A.locator(".space-welcome button", { hasText: "Go to" }).click();

  const desc = A.locator(".space-desc");
  await expect(desc, "the sidebar carries the description").toHaveText(
    DESCRIPTION,
  );
  // A spec cannot see truncation, so measure it: the line must stay one
  // line high while its content overflows the box.
  const line = await desc.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      overflows: el.scrollWidth > el.clientWidth,
      height: el.clientHeight,
      lineHeight: Number.parseFloat(s.lineHeight) || el.clientHeight,
      nowrap: s.whiteSpace === "nowrap",
    };
  });
  expect(line.nowrap, "the description never wraps").toBe(true);
  expect(line.overflows, "and overflows its box").toBe(true);
  expect(
    line.height,
    `so it is one line high (h=${line.height}, lh=${line.lineHeight})`,
  ).toBeLessThanOrEqual(line.lineHeight + 1);

  await desc.click();
  const dialog = A.locator(".space-about");
  await expect(dialog, "About this space shows the description").toContainText(
    DESCRIPTION,
  );
  await expect(dialog, "and the welcome in full").toContainText(
    "Welcome to the block.",
  );
  await expect(dialog, "About counts the members").toContainText("1 member");
  await A.keyboard.press("Escape");
  await expect(dialog, "Escape closes About").toHaveCount(0);

  // Closing returns focus to the description, and a focused control shows
  // its own tooltip — which would stand alongside the rail's below.
  await desc.blur();

  // ---- The rail tooltip names the space and what it is
  await A.locator(`.space-rail-list a[aria-label="${space.name}"]`).hover();
  const tip = A.locator(".tooltip");
  await expect(tip, "the rail tooltip names the space").toContainText(
    space.name,
  );
  await expect(tip, "and carries its description").toContainText(DESCRIPTION);
  await A.mouse.move(viewport.width / 2, viewport.height / 2);
  await expect(tip, "the tooltip closes on leave").toHaveCount(0);

  // ---- An invite link, and what a stranger sees before joining
  await A.locator(".sidebar-header .dots-menu-button").click();
  await A.locator('.dots-menu [role="menuitem"]', {
    hasText: "Invite people",
  }).click();
  await A.locator('.invite-form button[type="submit"]').click();
  const code = await A.locator(".invite-row .invite-code").innerText();
  await A.keyboard.press("Escape");

  const B = await (await browser.newContext({ viewport })).newPage();
  await B.goto(`/join/${code}`);
  await pastGate(B);
  await expect(B, "the link bounces a stranger to login").toHaveURL(/\/login/);
  const hero = B.locator(".invite-hero");
  await expect(hero, "the landing names the space").toContainText(space.name);
  await expect(hero, "shows its description").toContainText(DESCRIPTION);
  await expect(hero, "counts its members").toContainText("1 member");
  await expect(hero, "and says what redeeming grants").toContainText(
    "join as member",
  );
  await expect(
    hero,
    "the welcome text is never on the public landing",
  ).not.toContainText("Welcome to the block");

  await B.locator('input[autocomplete="username"]').fill(`bea${suffix}`);
  await B.locator('input[type="password"]').fill("correct horse battery");
  await B.locator('button[type="submit"]').click();

  // ---- The welcome: once, then never again
  const welcome = B.locator(".space-welcome");
  await expect(welcome, "a new member lands on the welcome").toBeVisible();
  await expect(welcome, "the welcome renders its markdown").toContainText(
    "Welcome to the block.",
  );
  await expect(welcome, "and leaves no asterisks").not.toContainText("**");
  await welcome.locator("button", { hasText: "Go to" }).click();
  await expect(B, "entering the space goes to the first channel").toHaveURL(
    /\/s\/[^/]+\/c\/[^/]+$/,
  );

  const bSpaceId = new URL(B.url()).pathname.split("/")[2];
  await B.goto(`/s/${bSpaceId}`);
  await pastGate(B);
  await expect(
    B,
    "the space goes straight to a channel a second time",
  ).toHaveURL(/\/s\/[^/]+\/c\/[^/]+$/);
  await expect(welcome, "the welcome is not offered a second time").toHaveCount(
    0,
  );
  // It stays reachable, which is the whole reason it is allowed to go away.
  await B.locator(".space-desc").click();
  await expect(
    B.locator(".space-about"),
    "a member can read the welcome again from About this space",
  ).toContainText("Welcome to the block.");

  // ---- A plain member may read it but not write it
  await B.goto(`/s/${bSpaceId}/settings?tab=about`);
  await expect(
    B.locator(".composer textarea"),
    "a member is bounced out of space settings",
  ).toBeVisible();
  await expect(
    B.locator(".about-section"),
    "a member has no About fields to write",
  ).toHaveCount(0);
});
