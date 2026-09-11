import { expect, reload, test } from "./lib";

declare global {
  interface Window {
    __csp: string[];
  }
}

// Security headers (STOOP-85): every response carries the policy, HSTS is
// withheld over plain HTTP, and the page still works under it — the one
// inline script (the theme stamp) runs, the bundle runs, nothing is
// blocked. Reads only; it needs no particular instance state.
// Ported from web/e2e/security.mjs (STOOP-238).
test("security headers and the page under them", async ({ page, request }) => {
  const res = await request.get("/");
  const origin = new URL(res.url());
  const h = (name: string) => res.headers()[name] ?? "";

  expect(h("x-content-type-options"), "X-Content-Type-Options").toBe("nosniff");
  expect(h("x-frame-options"), "X-Frame-Options").toBe("DENY");
  expect(h("referrer-policy"), "Referrer-Policy").toBe(
    "strict-origin-when-cross-origin",
  );
  expect(h("cross-origin-opener-policy"), "COOP").toBe("same-origin");
  expect(h("permissions-policy"), "Permissions-Policy").toContain(
    "camera=(self)",
  );
  expect(
    origin.protocol === "https:" || h("strict-transport-security") === "",
    "no HSTS over plain HTTP",
  ).toBe(true);

  const csp = h("content-security-policy");
  for (const directive of [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "worker-src 'self' blob:",
  ])
    expect(csp, `CSP has ${directive}`).toContain(directive);
  expect(csp, "script-src names a hash").toMatch(/script-src 'self' 'sha256-/);
  expect(csp, "script-src has no 'unsafe-inline'").not.toMatch(
    /script-src[^;]*'unsafe-inline'/,
  );
  expect(csp, "connect-src names this origin's websocket").toContain(
    `ws://${origin.host}`,
  );

  // The API and file routes answer with the same policy.
  const api = await request.get("/healthz");
  expect(
    api.headers()["content-security-policy"],
    "the policy is on every response, not just the page",
  ).toBe(csp);

  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI}`),
    );
  });
  const blocked = () => page.evaluate(() => window.__csp);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(await blocked(), "nothing blocked").toEqual([]);
  await expect(
    page.locator("html"),
    "the hashed inline script stamped the default theme",
  ).toHaveAttribute("data-theme", "brownstone");
  await expect(
    page.locator("#root > *").first(),
    "the bundle ran and rendered",
  ).toBeAttached();

  // The stamp reads localStorage, so a stored theme must survive a reload.
  await page.evaluate(() =>
    localStorage.setItem(
      "stoop.theme",
      JSON.stringify({ mode: "fixed", theme: "blackout" }),
    ),
  );
  await reload(page);
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator("html"),
    "a stored theme survives a reload",
  ).toHaveAttribute("data-theme", "blackout");
  expect(await blocked(), "still nothing blocked").toEqual([]);
});
