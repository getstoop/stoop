import { acceptDialog, ageSessions, expect, seed, signIn, test } from "./lib";

// Server admin actions that hand out lasting access need a recent sign-in
// (STOOP-512). The server refuses an old session before the handler runs
// (internal/app/e2e_admin_confirm_test.go has the list); this is the
// person's side: the refusal offers "Confirm it's you", wherever it came
// from, and brings them back afterwards.
test("an old admin session is asked to confirm it's them", async ({
  browser,
}) => {
  const { tokens } = await seed();
  await ageSessions();
  const P = await (await browser.newContext()).newPage();
  await signIn(P, tokens.ada, "/admin?tab=login");

  await P.locator("button[data-add-provider]").click();
  await P.locator('button[data-preset="Google"]').click();
  await P.locator('input[name="provider-client-id"]').fill("client-123");
  await P.locator('input[name="provider-client-secret"]').fill(
    "hunter2hunter2",
  );
  await P.locator('button[form="provider-form"]').click();

  await expect(
    P.locator(".modal[data-dialog]"),
    "the refusal offers to confirm",
  ).toContainText("Confirm it's you");
  await acceptDialog(P);
  await expect(P, "on the confirm page, with the way back").toHaveURL(
    /\/confirm\?next=.*admin.*login/,
  );
  await expect(
    P.locator('[data-provider-row="google"]'),
    "nothing was saved",
  ).toHaveCount(0);
});
