// Security headers (STOOP-85): every response carries the policy, HSTS is
// withheld over plain HTTP, and the page still works under it — the one
// inline script (the theme stamp) runs, the bundle runs, nothing is
// blocked. Reads only; it needs no particular instance state.
import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep } from "./lib.mjs";

let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};

const res = await fetch(`${base}/`);
const h = (name) => res.headers.get(name) ?? "";
check(h("x-content-type-options") === "nosniff", "X-Content-Type-Options");
check(h("x-frame-options") === "DENY", "X-Frame-Options");
check(
  h("referrer-policy") === "strict-origin-when-cross-origin",
  "Referrer-Policy",
);
check(h("cross-origin-opener-policy") === "same-origin", "COOP");
check(h("permissions-policy").includes("camera=(self)"), "Permissions-Policy");
check(
  new URL(base).protocol === "https:" || h("strict-transport-security") === "",
  "no HSTS over plain HTTP",
);

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
  check(csp.includes(directive), `CSP has ${directive}`);
check(/script-src 'self' 'sha256-[^']+'/.test(csp), "script-src names a hash");
check(
  !/script-src[^;]*'unsafe-inline'/.test(csp),
  "script-src has no 'unsafe-inline'",
);
check(
  csp.includes(`ws://${new URL(base).host}`),
  "connect-src names this origin's websocket",
);

// The API and file routes answer with the same policy.
const api = await fetch(`${base}/healthz`);
check(
  api.headers.get("content-security-policy") === csp,
  "the policy is on every response, not just the page",
);

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const p = await (await browser.createBrowserContext()).newPage();
p.on("pageerror", (e) => {
  console.log("[pageerror]", e.message);
  fails++;
});
await p.evaluateOnNewDocument(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) =>
    window.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI}`),
  );
});
await p.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(500);
const blocked = () => p.evaluate(() => window.__csp);
check((await blocked()).length === 0, `nothing blocked: ${await blocked()}`);
check(
  (await p.evaluate(() => document.documentElement.dataset.theme)) ===
    "brownstone",
  "the hashed inline script stamped the default theme",
);
check(
  await p.evaluate(() => document.getElementById("root").children.length > 0),
  "the bundle ran and rendered",
);

// The stamp reads localStorage, so a stored theme must survive a reload.
await p.evaluate(() =>
  localStorage.setItem(
    "stoop.theme",
    JSON.stringify({ mode: "fixed", theme: "blackout" }),
  ),
);
await p.reload({ waitUntil: "networkidle0" });
await sleep(300);
check(
  (await p.evaluate(() => document.documentElement.dataset.theme)) ===
    "blackout",
  "a stored theme survives a reload",
);
check(
  (await blocked()).length === 0,
  `still nothing blocked: ${await blocked()}`,
);

await browser.close();
console.log(fails ? `${fails} failure(s)` : "all passed");
process.exit(fails ? 1 : 0);
