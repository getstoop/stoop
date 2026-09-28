import { expect, seed, signIn, test } from "./lib";

// What an admin sees when the release index says this server is behind
// (docs/architecture/runtime.md → The update check). The suite's server is
// a local build, which never reads the index, so the two answers are
// supplied here; reading the index is covered by the Go tests.

const RPC = "**/stoop.instance.v1.InstanceService";

test("an outdated server tells its admin", async ({ browser }) => {
  const { tokens } = await seed({ users: ["ada"], channels: ["general"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route(`${RPC}/GetBuildInfo`, (route) =>
    route.fulfill({ json: { version: "0.1.0", goVersion: "go1.27.0" } }),
  );
  await context.route(`${RPC}/GetUpdate`, (route) =>
    route.fulfill({
      json: { latest: "0.3.0", available: true, outdated: true },
    }),
  );
  const page = await context.newPage();

  await signIn(page, tokens.ada);
  const admin = page.locator('a[title="Server admin"]');
  await expect(
    admin.locator(".pill-dot.warn"),
    "the rail's Server admin entry carries the dot",
  ).toBeVisible();

  await admin.click();
  const notice = page.getByTestId("outdated-notice");
  await expect(notice, "the warning names both versions").toContainText(
    "v0.1.0 is no longer supported. Update to v0.3.0",
  );
  await expect(notice, "and the command").toContainText("./stoop upgrade");

  const row = page.getByTestId("update-available");
  await expect(row, "About has the update row").toContainText(
    "v0.3.0 available",
  );
  await expect(
    row.getByRole("link"),
    "linking to the release notes",
  ).toHaveAttribute("href", /\/releases\/tag\/v0\.3\.0$/);
});
