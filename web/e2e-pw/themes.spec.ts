import { expect, seed, signIn, test } from "./lib";

// Themes: the profile's Appearance cards apply a theme immediately, it is
// stamped on <html data-theme> and survives a reload (localStorage), the
// page's colours actually change, "follow system" picks the dark/light
// pair by the OS setting, and nothing on the server is involved.
// Ported from web/e2e/themes.mjs (STOOP-238); filters added 2026-09-14.
test("picking a theme", async ({ browser }) => {
  const { tokens } = await seed({ users: ["ada"] });
  const A = await (await browser.newContext()).newPage();

  const html = A.locator("html");
  const cards = A.locator(".theme-card");
  const stored = () => A.evaluate(() => localStorage.getItem("stoop.theme"));
  const pref = async () => JSON.parse((await stored()) ?? "null");
  const bgOf = (selector: string) =>
    A.locator(selector).evaluate((e) => getComputedStyle(e).backgroundColor);

  await signIn(A, tokens.ada);
  await expect(html, "fresh browser starts on Brownstone").toHaveAttribute(
    "data-theme",
    "brownstone",
  );
  const darkBg = await bgOf("body");

  await A.goto("/profile?tab=appearance");
  const ids = () =>
    cards.evaluateAll((els: HTMLElement[]) => els.map((e) => e.dataset.theme));
  const filterChip = (label: string) =>
    A.locator(".theme-filters .chip", { hasText: label });

  // The picker opens on the tier of the theme in use: Brownstone is dark,
  // so the dark cards, and only those.
  await expect
    .poll(ids, { message: "opens on the dark tier" })
    .toEqual([
      "brownstone",
      "dusk",
      "bodega",
      "blackout",
      "fire-escape",
      "nightcap",
      "night-bus",
      "mailbox",
      "streetlight",
      "neon",
      "ferry",
      "bike-lane",
      "crosswalk",
      "concrete",
    ]);
  await expect(filterChip("Dark")).toHaveAttribute("aria-pressed", "true");

  // Accessible is a tag over the tiers, and each card says why.
  await filterChip("Accessible").click();
  await expect
    .poll(ids, { message: "accessible filter" })
    .toEqual(["blackout", "whiteout", "library", "crosswalk", "concrete"]);
  await expect(
    A.locator('.theme-card[data-theme="crosswalk"] .theme-card-why'),
    "an accessible card carries its reason",
  ).toContainText("colour blindness");

  await filterChip("Dim").click();
  await expect
    .poll(ids, { message: "dim filter" })
    .toEqual(["rooftop", "water-tower", "scaffolding", "sidewalk-chalk"]);
  await expect(
    A.locator('.theme-card[data-theme="rooftop"] .theme-card-kind'),
    "a dim card is labelled dim",
  ).toHaveText("dim");

  await filterChip("All").click();
  await expect
    .poll(() => cards.count(), { message: "all twenty-seven cards" })
    .toBe(27);
  await expect(
    A.locator(".theme-card.active"),
    "current theme is marked active",
  ).toHaveAttribute("data-theme", "brownstone");

  // Each card is painted by its own theme, not the page's.
  // (Fire Escape shares Brownstone's grounds and differs in accent, so the
  // identity of a palette is ground + accent.)
  const palettes = await cards.evaluateAll((els: HTMLElement[]) =>
    els.map((e) => {
      // Named rather than asserted away: without this a missing swatch is
      // a TypeError inside the page, which reads as a harness fault.
      const mock = e.querySelector(".theme-mock");
      const av = e.querySelector(".theme-mock-av");
      if (!mock || !av) return "missing swatch";
      return `${getComputedStyle(mock).backgroundColor}|${getComputedStyle(av).backgroundColor}`;
    }),
  );
  expect(new Set(palettes).size, "every card previews a distinct palette").toBe(
    palettes.length,
  );

  // Pick Daylight: stamped, stored, and the page turns light.
  await A.locator('.theme-card[data-theme="daylight"]').click();
  await expect(html, "clicking a card stamps data-theme").toHaveAttribute(
    "data-theme",
    "daylight",
  );
  await expect
    .poll(async () => (await pref())?.theme, {
      message: "choice is saved in localStorage",
    })
    .toBe("daylight");
  await A.goto("/");
  await expect(html, "theme survives navigation and reload").toHaveAttribute(
    "data-theme",
    "daylight",
  );
  expect(
    await bgOf(".message-list"),
    "the timeline is actually painted differently",
  ).not.toBe(darkBg);

  // Follow system: dark OS → the dark half (Brownstone), light OS → Daylight.
  await A.goto("/profile?tab=appearance");
  await expect(
    filterChip("Light"),
    "reopens on the tier of the theme in use, now Daylight",
  ).toHaveAttribute("aria-pressed", "true");
  await A.emulateMedia({ colorScheme: "dark" });
  await A.locator(".theme-system input").click();
  await filterChip("Dark").click();
  await expect(
    html,
    "follow system: dark OS picks the dark theme",
  ).toHaveAttribute("data-theme", "brownstone");
  await A.locator('.theme-card[data-theme="dusk"]').click();
  await expect(
    html,
    "in system mode a card click applies that theme",
  ).toHaveAttribute("data-theme", "dusk");
  await expect
    .poll(async () => (await pref())?.dark, {
      message: "…and sets that half of the pair",
    })
    .toBe("dusk");
  await A.emulateMedia({ colorScheme: "light" });
  await expect(
    html,
    "switching the OS to light flips to the light theme live",
  ).toHaveAttribute("data-theme", "daylight");

  // Another browser is untouched: the choice is per client.
  const B = await (await browser.newContext()).newPage();
  await B.goto("/login");
  await expect(
    B.locator("html"),
    "a different browser still starts on the default",
  ).toHaveAttribute("data-theme", "brownstone");
});
