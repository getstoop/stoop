import type { Page } from "@playwright/test";
import { channelLink, expect, pastGate, say, seed, signIn, test } from "./lib";

const atPath = (p: Page, want: string, message: string) =>
  expect.poll(() => new URL(p.url()).pathname, { message }).toBe(want);
const param = (p: Page, name: string, message: string) =>
  expect.poll(() => new URL(p.url()).searchParams.get(name), { message });

// Message search (STOOP-87): the header launcher, the results page and
// its chips, opening a result in place, and the phone's icon.
// Ported from web/e2e/search.mjs (STOOP-238). /s/…/search is not a shared
// link, so those visits meet no gate.
test("searching a space's messages", async ({ browser }) => {
  const { tokens, space, channels } = await seed({
    channels: ["general", "garden"],
  });
  const spaceId = space.id;
  const generalId = channels.general;
  const gardenId = channels.garden;
  const search = (p: Page, query: string) =>
    p.goto(`/s/${spaceId}/search${query}`);

  // A and B, both members, in a space with a second channel.
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await expect(A.locator(".composer textarea")).toBeVisible();
  await signIn(B, tokens.bea);
  await expect(B.locator(".composer textarea")).toBeVisible();

  const rows = (p: Page) => p.locator(".search-row .search-row-body");
  const field = (p: Page) => p.locator(".search-form input");
  const searchFromHeader = async (p: Page, q: string) => {
    await p.locator(".search-launch input").fill(q);
    await p.locator(".search-launch input").press("Enter");
    await expect(p.locator(".search-page")).toBeVisible();
  };

  // Three messages with a shared word, across two channels and two
  // people, oldest first.
  await say(A, "Restarted the LiveKit container at 3am");
  await expect(A.locator(".message-content", { hasText: "3am" })).toBeVisible();
  await say(B, "anyone else get a LiveKit token error?");
  await expect(
    A.locator(".message-content", { hasText: "token error" }),
  ).toBeVisible();
  await channelLink(A, "garden").click();
  await expect(A, "A moved to #garden").toHaveURL(
    `/s/${spaceId}/c/${gardenId}`,
  );
  await say(A, "tomatoes are in, LiveKit is not");
  await expect(
    A.locator(".message-content", { hasText: "tomatoes" }),
  ).toBeVisible();

  // The header field opens the results page with the words.
  await expect(
    A.locator(".channel-header .search-launch input"),
    "a space channel's header carries the search field",
  ).toBeVisible();
  await searchFromHeader(A, "livekit");
  await atPath(A, `/s/${spaceId}/search`, "Enter opens the results route");
  await param(A, "q", "the route carries the query").toBe("livekit");
  await param(A, "c", "the route carries the origin channel").toBe(gardenId);
  await expect(
    A.locator(".search-count"),
    "the count reads 3 messages",
  ).toHaveText("3 messages");
  await expect(rows(A), "three results").toHaveCount(3);
  await expect(rows(A).first(), "newest first").toContainText("tomatoes");
  await expect(rows(A).nth(2), "oldest last").toContainText("Restarted");
  await expect(
    A.locator(".search-row mark.search-hit"),
    "the matched word is marked in every row",
  ).toHaveText(["LiveKit", "LiveKit", "LiveKit"]);
  await expect(field(A), "the results field keeps the query").toHaveValue(
    "livekit",
  );
  await expect(
    A.locator(".search-row .search-row-title").first(),
    "a row names its channel",
  ).toHaveText(/in #(general|garden)/);

  // Prefix on the last word.
  await field(A).fill("restart");
  await field(A).press("Enter");
  await expect(rows(A), '"restart" matches through the prefix').toHaveCount(1);
  await expect(rows(A), "and finds Restarted").toContainText(["Restarted"]);

  // The scope chips write in:#channel into the query.
  await search(A, `?q=livekit&c=${generalId}`);
  const chips = A.locator(".search-scope .chip");
  await expect(
    chips,
    "opened from a channel, the scope offers two",
  ).toHaveCount(2);
  await expect(chips.first(), "All channels is the active chip").toHaveClass(
    /active/,
  );
  await A.getByRole("button", { name: "This channel" }).click();
  await param(A, "q", "This channel writes in:#general into the query").toBe(
    "in:#general livekit",
  );
  await expect(field(A), "and into the field").toHaveValue(
    "in:#general livekit",
  );
  await expect(rows(A), "scoped to #general: two results").toHaveCount(2);
  await expect(
    A.locator(".search-row", { hasText: "tomatoes" }),
    "none of them from #garden",
  ).toHaveCount(0);
  await A.getByRole("button", { name: "All channels" }).click();
  await param(A, "q", "All channels takes the filter back out").toBe("livekit");
  await expect(rows(A), "and all three are back").toHaveCount(3);

  // A result opens the channel at that message. The timeline drops ?m=
  // from the address once it has landed, so the flashed row is the
  // evidence.
  await A.locator(".search-row").first().click();
  const flashed = A.locator(".message.flash");
  await expect(
    flashed.locator(".message-content"),
    "clicking the newest result lands on it",
  ).toContainText("tomatoes");
  await atPath(A, `/s/${spaceId}/c/${gardenId}`, "in #garden, where it was");

  // Close returns where the search began; Escape does the same.
  await search(A, `?q=livekit&c=${generalId}`);
  await A.getByRole("button", { name: "Close" }).click();
  await atPath(
    A,
    `/s/${spaceId}/c/${generalId}`,
    "Close goes back to the channel the search was opened from",
  );
  await search(A, `?c=${generalId}`);
  await expect(
    field(A),
    "arriving without a query focuses the field",
  ).toBeFocused();
  await expect(
    A.locator(".search-scroll"),
    "the empty page explains the syntax",
  ).toContainText("Type a word");
  await A.keyboard.press("Escape");
  await atPath(
    A,
    `/s/${spaceId}/c/${generalId}`,
    "Escape in an empty field closes the page",
  );

  // Nothing found, and a filter the server refuses.
  await search(A, `?q=zzzzqqq&c=${generalId}`);
  await expect(
    A.locator(".search-scroll"),
    "no results says so, with the words",
  ).toContainText("No messages match zzzzqqq");
  await search(A, `?q=before%3Ayesterday+gate&c=${generalId}`);
  await expect(
    A.locator(".search-error"),
    "a bad date filter shows the server's wording",
  ).toContainText("before: wants a date");

  // B sees the same results, including A's messages.
  await search(B, `?q=livekit&c=${generalId}`);
  await expect(
    rows(B),
    "another member finds everyone's messages in the space",
  ).toHaveCount(3);

  // Phone: the icon instead of the field, and a tap opens the page.
  const P = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await signIn(P, tokens.bea, `/s/${spaceId}/c/${generalId}`);
  await pastGate(P);
  await expect(
    P.locator(".search-launch"),
    "on a phone the header hides the field",
  ).toHaveCSS("display", "none");
  await expect(
    P.locator(".search-launch-button"),
    "and shows the icon instead",
  ).not.toHaveCSS("display", "none");
  await P.locator(".search-launch-button").tap();
  await atPath(P, `/s/${spaceId}/search`, "a tap opens the results page");
  await expect(field(P), "with the field focused").toBeFocused();
});
