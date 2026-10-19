import { acceptDialog, expect, say, seed, signIn, test } from "./lib";

// The retention settings (STOOP-106, STOOP-112): a shorter period asks
// first with what it would delete, a longer one doesn't, and the history
// head says messages are deleted while message retention is on. Expired
// attachments are covered by the Go tests: a spec can't age a file.
test("retention settings", async ({ browser }) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  // The seeded first account is the server admin.
  await signIn(A, tokens.ada);
  await say(A, "tomatoes are in");
  const head = A.locator(".history-head");
  await expect(head, "no note while messages are kept forever").toHaveText(
    "Beginning of #general",
  );

  await A.goto("/admin");
  await A.locator('.settings-tab[data-tab="storage"]').click();
  const section = A.locator(".retention-section");
  const save = section.locator("button.primary");
  const dialog = A.locator(".modal[data-dialog]");

  // ---- On: asks first, with the counts
  await section.locator("#message-retention").fill("90");
  await section.locator("#attachment-retention").fill("30");
  await save.click();
  await expect(dialog, "turning retention on asks first").toContainText(
    "0 messages older than 90 days and 0 attachments older than 30 days",
  );
  await acceptDialog(A);
  await expect(section, "…and saves once confirmed").toContainText("Saved.");

  // ---- Longer: saves without asking
  await section.locator("#message-retention").fill("365");
  await save.click();
  await expect(section).toContainText("Saved.");
  await expect(dialog, "a longer period doesn't ask").toHaveCount(0);

  // ---- The history head says so
  await A.goto("/");
  await expect(head, "the history head explains the gap").toHaveText(
    "Beginning of #general · messages older than 365 days are deleted",
  );

  // ---- Blank keeps forever again, without asking
  await A.goto("/admin");
  await A.locator('.settings-tab[data-tab="storage"]').click();
  await section.locator("#message-retention").fill("");
  await section.locator("#attachment-retention").fill("");
  await save.click();
  await expect(section).toContainText("Saved.");
  await expect(dialog).toHaveCount(0);
  await A.goto("/");
  await expect(head, "the note goes with it").toHaveText(
    "Beginning of #general",
  );
});
