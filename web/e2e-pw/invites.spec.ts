import type { Page } from "@playwright/test";
import {
  acceptDialog,
  COMPOSER,
  expect,
  pastGate,
  skipReachability,
  test,
} from "./lib";

// Invites end to end: setup mints the instance, the owner makes an invite
// on Space settings → Invites, someone arrives on its link and signs up
// into the space, a member can't invite, a bad code says so, a revoked
// one is refused, and a plain re-login still lands in a space.
// Ported from web/e2e/invites.mjs (STOOP-238). The subject here is
// signing up, so this one still drives the UI rather than seeding.
test("creating, sharing and revoking an invite", async ({ browser }) => {
  const suffix = String(Date.now() % 1000000);
  const password = "correct horse battery";
  const spaceName = `Stoop HQ ${suffix}`;

  const dots = (p: Page) => p.locator(".sidebar-header .dots-menu-button");
  const menuItems = async (p: Page) => {
    await dots(p).click();
    const items = p.locator(".dots-menu button");
    await expect(items.first()).toBeVisible();
    const labels = (await items.allTextContents()).map((s) => s.trim());
    await p.keyboard.press("Escape");
    await expect(p.locator(".dots-menu")).toHaveCount(0);
    return labels;
  };
  const pickMenu = async (p: Page, label: string) => {
    await dots(p).click();
    await p.locator(".dots-menu button", { hasText: label }).click();
  };
  const credentials = async (p: Page, username: string) => {
    await p.locator('input[autocomplete="username"]').fill(username);
    await p.locator('input[type="password"]').fill(password);
    await p.locator('button[type="submit"]').click();
  };
  // pastGate() only takes the way past a gate that has already rendered,
  // so wait for the app's first paint before asking.
  const enter = async (p: Page, url: string) => {
    await p.goto(url);
    await p
      .locator(".open-in-app button, .app-shell, .login-card, .centered")
      .first()
      .waitFor();
    await pastGate(p);
  };

  // ---- A: fresh instance → setup (admin + first space), then a second
  // space via the rail.
  const A = await (await browser.newContext()).newPage();
  await A.goto("/");
  await expect(A, "a fresh instance opens on setup").toHaveURL(/\/setup$/);
  await credentials(A, `webA${suffix}`);
  await A.getByLabel("Space name").fill(`First ${suffix}`);
  await A.locator('button[type="submit"]').click();
  await skipReachability(A);
  await A.getByRole("button", { name: `Go to First ${suffix}` }).click();
  await expect(A, "A completes setup and lands in a space").toHaveURL(
    /\/s\/[^/]+\/c\/[^/]+$/,
  );
  const base = new URL(A.url()).origin;

  await A.locator('button[title="Create a space"]').click();
  await acceptDialog(A, spaceName);
  // A channel-URL pattern matches the space A is already in, so it passes
  // before the navigation and captures the wrong id. Wait for the new
  // space's name instead.
  await expect(
    A.locator(".space-name"),
    "A navigated into new space",
  ).toHaveText(spaceName);
  const spaceId = new URL(A.url()).pathname.split("/")[2];

  // Inviting lives on its settings page, open to anyone who may invite.
  await pickMenu(A, "Invite people");
  await expect(A, "Invite people opens Space settings → Invites").toHaveURL(
    /\/settings\?tab=invites$/,
  );
  const invitesCard = A.locator(".card", { hasText: "Invites" });
  await expect(
    invitesCard.locator(".dt-message"),
    "the page shows an empty list",
  ).toContainText("No invites yet");

  // Making one is a form with every field in view. The link lands on the
  // clipboard when it is made.
  await A.evaluate(() => {
    const box = { value: "" };
    (globalThis as unknown as { __copied: { value: string } }).__copied = box;
    navigator.clipboard.writeText = (text: string) => {
      box.value = text;
      return Promise.resolve();
    };
  });
  const copied = () =>
    A.evaluate(
      () =>
        (globalThis as unknown as { __copied: { value: string } }).__copied
          .value,
    );
  await invitesCard.getByRole("button", { name: "New invite" }).click();
  const dialog = A.locator(".modal", { hasText: "New invite" });
  await expect(dialog, "New invite opens a dialog").toBeVisible();
  await expect(
    dialog.getByLabel("Joins as"),
    "no role to pick: every invite joins as a member",
  ).toHaveCount(0);
  await dialog.getByLabel("Label (optional)").fill("Book club");
  await dialog.getByLabel("Expires after").selectOption("86400");
  await dialog.locator('input[type="number"]').fill("5");
  await dialog.getByRole("button", { name: "Create invite" }).click();
  await expect(dialog, "creating closes the dialog").toHaveCount(0);

  const row = invitesCard.locator(".dt-row");
  await expect(row, "the new invite is the one row").toHaveCount(1);
  const code = (await row.getAttribute("data-code")) ?? "";
  expect(code, "invite created with a base58 code").toMatch(
    /^[1-9A-HJ-NP-Za-km-z]{10}$/,
  );
  await expect(
    row.locator(".invite-label"),
    "the row shows its label",
  ).toHaveText("Book club");
  await expect(row, "…and how many uses").toContainText("0 of 5");
  await expect(row, "…and when it expires").toContainText("Within a day");
  await expect
    .poll(copied, { message: "Create puts the link on the clipboard" })
    .not.toBe("");
  const copiedLink = new URL(await copied());
  expect(copiedLink.origin, "the link names this server").toBe(base);
  expect(copiedLink.pathname, "…this invite").toBe(`/join/${code}`);
  expect(copiedLink.searchParams.get("space"), "…and this space").toBe(
    spaceName,
  );

  // The row's Copy link hands over the same link again.
  await A.evaluate(() => {
    (globalThis as unknown as { __copied: { value: string } }).__copied.value =
      "";
  });
  await row.getByRole("button", { name: "Copy link" }).click();
  await expect
    .poll(copied, { message: "Copy link copies the link" })
    .toBe(copiedLink.toString());
  await A.getByRole("link", { name: "Back to space" }).click();
  await expect(A, "Back to space returns to the channel").toHaveURL(
    /\/s\/[^/]+\/c\/[^/]+$/,
  );

  // ---- B: logged out, visit /join/<code> → login with redirect → lands
  // in the space.
  const B = await (await browser.newContext()).newPage();
  const link = `${base}/join/${code}?space=${encodeURIComponent(spaceName)}`;
  // By hand rather than through the gate helper: the choice an invite
  // link lands on is what is under test here.
  await B.goto(link);
  await expect(B.locator(".open-in-app")).toBeVisible();
  expect(new URL(B.url()).pathname, "the first page keeps the invite URL").toBe(
    `/join/${code}`,
  );
  await expect(
    B.locator(".invite-hero"),
    "…does nothing with the invite: no space named",
  ).toHaveCount(0);
  await expect(
    B.locator('input[autocomplete="username"]'),
    "…and no form",
  ).toHaveCount(0);

  // The link it hands the shell: this server, and this invite with the
  // hint it carried. Resolved the way the shell resolves it — its `path`
  // against the server it names (deeplink.ts → targetUrl).
  const deep = new URL(
    (await B.locator(".open-in-app a").getAttribute("href")) ?? "",
  );
  const server = deep.searchParams.get("server");
  const target = new URL(deep.searchParams.get("path") ?? "", `${server}/`);
  expect(deep.protocol, "the handoff is a stoop:// link").toBe("stoop:");
  expect(deep.hostname || deep.pathname.replace(/^\/+/, ""), "…to open").toBe(
    "open",
  );
  expect(server, "…naming this server").toBe(base);
  expect(target.pathname, "…and this invite").toBe(`/join/${code}`);
  expect(target.searchParams.get("space"), "…with the hint it carried").toBe(
    spaceName,
  );

  await B.locator(".open-in-app button").click();
  await expect(
    B.locator(".invite-hero"),
    "continuing in this browser goes on to the invite landing",
  ).toBeVisible();
  await expect(
    B.locator(".open-in-app"),
    "…leaving the gate behind",
  ).toHaveCount(0);
  const bUrl = new URL(B.url());
  const redirect = new URL(bUrl.searchParams.get("redirect") ?? "/", base);
  expect(bUrl.pathname, "logged-out /join bounces to login").toBe("/login");
  expect(redirect.pathname, "…with the invite as the redirect").toBe(
    `/join/${code}`,
  );
  expect(redirect.searchParams.get("space"), "…space hint and all").toBe(
    spaceName,
  );
  await expect(
    B.locator(".invite-next"),
    "the landing names the next step",
  ).toContainText("Create an account to join");
  await expect(B.locator(".invite-hero"), "…and the space").toContainText(
    spaceName,
  );
  await expect(
    B.locator('button[type="submit"]'),
    "…on the button too",
  ).toHaveText("Create account & join");
  await expect
    .poll(
      () =>
        B.locator(".invite-choice button").evaluateAll((els: HTMLElement[]) =>
          els.map((e) => e.dataset.mode),
        ),
      { message: "invite landing offers both paths: new and returning" },
    )
    .toEqual(["register", "login"]);
  await B.locator('.invite-choice button[data-mode="login"]').click();
  await expect(
    B.locator(".invite-next"),
    "choosing 'I already have an account' keeps invite context",
  ).toContainText("Log in to join");
  await expect(
    B.locator('button[type="submit"]'),
    "…and says so on the button",
  ).toHaveText("Log in & join");

  // A bare link (no ?space=) still names the space: since STOOP-108 the
  // landing asks the server what the code is for rather than trusting the
  // hint in the link.
  const bare = await B.context().newPage();
  await enter(bare, `${base}/join/${code}`);
  await expect(
    bare.locator(".invite-hero"),
    "bare link names the space from the server's invite lookup",
  ).toContainText(spaceName);
  await bare.close();

  await B.locator('.invite-choice button[data-mode="register"]').click();
  await credentials(B, `webB${suffix}`);
  await expect
    .poll(() => B.evaluate(() => localStorage.getItem("stoop.hasAccount")), {
      message: "a successful login marks this browser as having an account",
    })
    .toBe("1");
  await expect(B, "B lands in A's space after login").toHaveURL(
    new RegExp(`/s/${spaceId}`),
  );
  await expect(B.locator(".space-name"), "B sees the space name").toContainText(
    "Stoop HQ",
  );

  // ---- realtime: A sends, B receives
  const message = `hi from A ${suffix}`;
  await A.locator(".composer .rich-editor-content").fill(message);
  await A.keyboard.press("Enter");
  await expect(
    B.locator(".message-list"),
    "B sees A's message in realtime",
  ).toContainText(message);
  await expect(A.locator(".message-list"), "A sees own message").toContainText(
    message,
  );

  // ---- B is a plain member: no Invite, and the settings page turns
  // them away. A's page shows the use count and who joined. A bad code
  // in the rail's join prompt errors clearly.
  expect(await menuItems(B), "member B is not offered Invite").not.toContain(
    "Invite people",
  );
  await B.goto(`${base}/s/${spaceId}/settings?tab=invites`);
  await expect(
    B.locator(COMPOSER),
    "a member who can't invite is sent back to the space",
  ).toBeVisible();
  expect(new URL(B.url()).pathname, "…and off the settings page").not.toMatch(
    /settings/,
  );
  await pickMenu(A, "Invite people");
  await expect(row, "use count is 1 of 5 after B joined").toContainText(
    "1 of 5",
  );
  await row.getByRole("button", { name: "Who joined with Book club" }).click();
  await expect(
    invitesCard.locator(`[data-uses-of="${code}"]`),
    "opening the row says who joined",
  ).toContainText(`webB${suffix}`);
  await A.getByRole("link", { name: "Back to space" }).click();

  await B.locator('button[title="Join a space with an invite code"]').click();
  await acceptDialog(B, "nope12345X");
  // The prompt stays open with the answer in it and says why.
  const joinPrompt = B.locator('.modal[data-dialog="prompt"]');
  await expect(
    joinPrompt.locator(".field-error"),
    "a bad code says it wasn't found, under the field",
  ).toContainText("invite not found");
  await expect(joinPrompt.locator("input")).toHaveValue("nope12345X");
  await B.keyboard.press("Escape");
  await expect(joinPrompt).toHaveCount(0);

  // ---- A revokes; C visiting the link is refused
  await pickMenu(A, "Invite people");
  await row.getByRole("button", { name: "Options for Book club" }).click();
  await A.getByRole("menuitem", { name: "Revoke" }).click();
  await acceptDialog(A);
  await expect(row, "a spent invite leaves the list").toHaveCount(0);
  await invitesCard.locator(".dt-hidden-toggle input").check();
  await expect(row, "…until spent ones are shown").toHaveCount(1);
  await expect(row, "revoked invite shown as inactive").toHaveClass(/inactive/);
  await expect(row.locator(".badge"), "…and says so").toHaveText("Revoked");
  await A.getByRole("link", { name: "Back to space" }).click();

  const C = await (await browser.newContext()).newPage();
  await enter(C, `${base}/join/${code}`);
  await credentials(C, `webC${suffix}`);
  await expect(
    C.locator("p.error").first(),
    "signup with a revoked link is refused",
  ).toContainText("revoked");

  // ---- plain re-login of an existing account (the reported bug)
  await A.locator(".space-pill.avatar").click();
  // Log out is the last entry of the account nav; the rail pill still
  // lands on Profile.
  await A.locator(".logout-link").click();
  await acceptDialog(A);
  await expect(A, "logout → /login with no redirect").toHaveURL(/\/login$/);
  await credentials(A, `webA${suffix}`);
  await expect(A, "existing-account login lands in a space").toHaveURL(/\/s\//);
});
