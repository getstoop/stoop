import { expect, reload, seed, signIn, test } from "./lib";

// Admin storage tab (STOOP-70): usage, the upload limit, cleanup on demand.
// Ported from web/e2e/storage.mjs (STOOP-238).
test("the storage limit, what it says and cleaning up", async ({ browser }) => {
  const { tokens } = await seed({ users: ["ada"] });
  const A = await (await browser.newContext()).newPage();
  // The seeded first account is the server admin.
  await signIn(A, tokens.ada, "/admin");

  const storage = A.locator(".storage-section");
  const cleanup = A.locator(".cleanup-section");
  const bar = A.locator(".storage-bar");
  const tab = A.locator('.settings-tab[data-tab="storage"]');

  await expect(tab, "the admin page offers a Storage tab").toBeVisible();
  await expect(storage, "storage isn't on the default tab").toHaveCount(0);
  await tab.click();

  await expect(storage, "usage line reads empty").toContainText(
    "0 B in 0 files",
  );
  // "· no limit" and not "no limit": the field's own hint ends "0 is no
  // limit", which would match whatever the setting says.
  await expect(storage, "no limit by default").toContainText("· no limit");
  await expect(bar, "no bar without a limit").toHaveCount(0);

  await A.locator(".storage-quota input").fill("1");
  await A.locator(".storage-section button.primary").click();
  await expect(storage, "limit saved and shown").toContainText("limit 1.0 GB");
  await expect(storage, "free space shown").toContainText("1.0 GB left");
  await expect(bar, "bar shows against a limit").toBeVisible();

  await reload(A);
  await expect(storage, "limit persists").toContainText("limit 1.0 GB");

  await cleanup.locator(".sweep-button").click();
  await expect(cleanup, "cleanup runs and reports").toContainText(
    "Removed 0 files",
  );

  await A.locator(".storage-quota input").fill("0");
  await A.locator(".storage-section button.primary").click();
  await expect(storage, "limit cleared").toContainText("· no limit");
  await expect(bar, "bar hidden again").toHaveCount(0);
});
