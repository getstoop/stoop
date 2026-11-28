import {
  COMPOSER,
  expect,
  pastGate,
  reload,
  say,
  seed,
  signIn,
  test,
} from "./lib";

// A conversation with only yourself in it, for notes and lists: opened
// from the New conversation picker or from your own profile card, named
// after you, alerting nobody, and not in anyone else's list.
test("notes to self", async ({ browser }) => {
  const { suffix, tokens } = await seed({
    users: ["ada", "bea"],
    channels: ["general"],
  });
  const aName = `ada${suffix}`;

  const open = async (token: string) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, token);
    await page.locator(COMPOSER).waitFor();
    return page;
  };
  const A = await open(tokens.ada);
  const B = await open(tokens.bea);
  const dmsPill = A.locator(".space-pill.dms");

  // From the picker: ada heads the list, marked as herself.
  await dmsPill.click();
  await A.locator(".dm-empty").waitFor();
  await A.getByRole("button", { name: "New conversation" }).click();
  const own = A.locator(".candidate-row").first();
  await expect(own, "ada heads her own picker").toContainText(`${aName} (you)`);
  // Picking herself after someone else means only her.
  await A.locator(".candidate-row", { hasText: `bea${suffix}` }).click();
  await own.click();
  await expect(
    A.locator(".picked-chips .chip"),
    "picking yourself clears the others",
  ).toHaveCount(1);
  await A.getByRole("button", { name: "Message", exact: true }).click();
  await expect(A, "it opens as a conversation").toHaveURL(/\/dm\//);
  const notesPath = new URL(A.url()).pathname;
  await expect(A.locator(".dm-title"), "named after ada").toContainText(
    `${aName} (you)`,
  );
  await expect(
    A.locator(".dm-title .online-dot"),
    "no presence dot on your own notes",
  ).toHaveCount(0);
  await expect(
    A.locator(COMPOSER),
    "the placeholder is the title, not a handle",
  ).toHaveAttribute("aria-placeholder", `Message ${aName} (you)`);
  await expect(A.locator(".history-head")).toContainText(
    "Beginning of your notes",
  );

  // A note: no badge, no alert, and it is still there after a reload.
  await say(A, "buy milk");
  await expect(
    A.locator(".message-content", { hasText: "buy milk" }),
  ).toBeVisible();
  await expect(
    dmsPill.locator(".pill-badge"),
    "your own note raises no badge",
  ).toHaveCount(0);
  await expect(
    A.locator(".space-pill.activity .pill-dot"),
    "nor an alert",
  ).toHaveCount(0);
  await reload(A);
  await expect(
    A.locator(".message-content", { hasText: "buy milk" }),
    "the note survives a reload",
  ).toBeVisible();
  await expect(A.locator(".dm-link"), "one row in the list").toHaveCount(1);
  await expect(
    A.locator(".dm-link .channel-name"),
    "the row is named after ada too",
  ).toHaveText(`${aName} (you)`);

  // From her own card in a space: the same conversation.
  await A.locator(".space-rail-list a.space-pill").first().click();
  await A.locator(".member-row", { hasText: aName }).click();
  await expect(
    A.locator(".user-card .edit-profile-button"),
    "her card still offers Edit profile",
  ).toBeVisible();
  await A.locator(".user-card .notes-button").click();
  await expect(A, "the card's Message opens the same notes").toHaveURL(
    new RegExp(`${notesPath}$`),
  );

  // Nobody else has it: the URL bounces bea to her own, empty list.
  await B.goto(notesPath);
  await pastGate(B);
  await expect(B, "bea is bounced off ada's notes").toHaveURL(/\/dm$/);
  await expect(
    B.locator(".dm-empty"),
    "…and has no conversation of her own",
  ).toBeVisible();
});
