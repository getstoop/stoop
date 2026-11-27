import type { Locator, Page } from "@playwright/test";
import {
  COMPOSER,
  channelLink,
  expect,
  focus,
  seed,
  signIn,
  test,
} from "./lib";

// Find a time (STOOP-559): a poll whose options are times. Made from the
// composer's Find a time button and from /when, each time picked through
// DateTimeField's grid; the card words each time in the reader's own
// zone, so two people in different zones see different labels on the
// same option; a vote, the close, and the closing line naming the
// winning time. The form's rules are core/timePollForm.test.ts, the
// wording core/dates.test.ts.

// A day and a time from now in the page's own zone: the day as the
// grid's month and its button's name, and the instant it names.
type Slot = { month: string; name: string; ms: number };
const slotFromNow = (page: Page, days: number, hour: number, minute = 0) =>
  page.evaluate(
    ({ days, hour, minute }) => {
      const now = new Date();
      const d = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + days,
        hour,
        minute,
      );
      const pad = (value: number) => String(value).padStart(2, "0");
      return {
        month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
        name: d.toLocaleDateString([], {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        ms: d.getTime(),
      };
    },
    { days, hour, minute },
  );

// An instant as the page's card words an option (slotLabel), and as its
// closing line words a winner (slotPhrase), in the page's own zone.
const labelIn = (page: Page, ms: number) =>
  page.evaluate((ms) => {
    const d = new Date(ms);
    return d.toLocaleString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(d.getFullYear() !== new Date().getFullYear()
        ? { year: "numeric" }
        : {}),
      hour: "numeric",
      minute: "2-digit",
    });
  }, ms);
const phraseIn = (page: Page, ms: number) =>
  page.evaluate((ms) => {
    const d = new Date(ms);
    const day = new Intl.DateTimeFormat([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(d.getFullYear() !== new Date().getFullYear()
        ? { year: "numeric" }
        : {}),
    })
      .formatToParts(d)
      .map((part) =>
        part.type === "literal"
          ? part.value.replace(/\s*[,،，]\s*/g, " ")
          : part.value,
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    const time = d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${day} at ${time}`;
  }, ms);

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Picks a slot in a row's DateTimeField: the panel opened from the field,
// turned to the slot's month with the arrows, the day clicked in the grid
// (the date is never typed), the time typed, and Done.
async function pick(page: Page, field: Locator, slot: Slot, time: string) {
  const panel = page.getByRole("dialog", { name: "Pick a date and time" });
  const grid = panel.locator(".date-time-grid");
  await field.click();
  await expect(panel).toBeVisible();
  for (let turns = 0; turns < 14; turns++) {
    const shown = (await grid.getAttribute("data-month")) ?? "";
    if (shown === slot.month) break;
    await panel
      .getByRole("button", {
        name: shown < slot.month ? "Next month" : "Previous month",
      })
      .click();
  }
  await expect(grid).toHaveAttribute("data-month", slot.month);
  await grid.getByRole("button", { name: slot.name, exact: true }).click();
  await panel.getByRole("textbox", { name: "Time" }).fill(time);
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toHaveCount(0);
}

test("find a time: made, read in two zones, voted on and closed", async ({
  browser,
}) => {
  const { tokens } = await seed({ channels: ["general"] });
  // Ada asks from New York; Bea reads from Tokyo.
  const A = await (
    await browser.newContext({ timezoneId: "America/New_York" })
  ).newPage();
  const B = await (
    await browser.newContext({ timezoneId: "Asia/Tokyo" })
  ).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await channelLink(A, "general").click();
  await channelLink(B, "general").click();
  const composer = A.locator(COMPOSER);
  await expect(composer).toBeVisible();

  const QUESTION = "When do we start the winter campaign?";
  const form = A.getByRole("dialog", { name: "Find a time" });
  const question = form.getByRole("textbox", { name: "Question" });
  const post = form.getByRole("button", { name: "Post poll" });
  const time = (n: number) =>
    form.getByRole("button", { name: `Time ${n}`, exact: true });

  // ---- The button beside Poll opens the form: two empty times,
  // several to choose, the zone named.
  const button = A.getByRole("button", { name: "Find a time" });
  await button.click();
  await expect(form).toBeVisible();
  await expect(question, "the question has focus").toBeFocused();
  await expect(
    form.getByRole("button", { name: "Several times" }),
    "the form starts on several",
  ).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByText("2 of 10")).toBeVisible();
  await expect(time(1)).toHaveText("Pick a date and time");
  await expect(
    form.getByText(
      /^Times are in your time zone: New York \(GMT−[45]\)\. Everyone sees them in their own\.$/,
    ),
  ).toBeVisible();
  await expect(post, "Post is off on an empty form").toBeDisabled();

  // ---- Refusals: the same time twice is said under the second, and
  // Post stays off until it changes.
  const thursday = await slotFromNow(A, 3, 19);
  const friday = await slotFromNow(A, 4, 20);
  const saturday = await slotFromNow(A, 5, 14);
  await question.fill(QUESTION);
  await pick(A, time(1), thursday, "19:00");
  await expect(time(1)).toHaveText(await labelIn(A, thursday.ms));
  await pick(A, time(2), thursday, "19:00");
  await expect(
    form.locator(".field-error", {
      hasText: "This time is already in the list.",
    }),
    "the same time twice is refused",
  ).toBeVisible();
  await expect(time(2)).toHaveAttribute("aria-invalid", "true");
  // Said politely once the panel has closed, naming the row.
  await expect(
    form.locator('[aria-live="polite"]', {
      hasText: "Time 2: This time is already in the list.",
    }),
  ).toHaveCount(1);
  await expect(post).toBeDisabled();
  await pick(A, time(2), friday, "20:00");
  await expect(
    form.locator(".field-error", {
      hasText: "This time is already in the list.",
    }),
  ).toHaveCount(0);
  await expect(post).toBeEnabled();

  // Add time adds a row and focuses it; a third time.
  await form.getByRole("button", { name: "Add time" }).click();
  await expect(form.getByText("3 of 10")).toBeVisible();
  await expect(time(3), "the new row has focus").toBeFocused();
  await pick(A, time(3), saturday, "14:00");
  await post.click();
  await expect(form, "the form closes once it is posted").toHaveCount(0);
  await expect(
    composer,
    "a posted poll sends focus to the words",
  ).toBeFocused();

  // ---- The card: each time in the reader's own zone, earliest first,
  // and the zone said.
  const card = (page: Page) => page.locator(".poll-row", { hasText: QUESTION });
  const slots = [thursday, friday, saturday];
  for (const [page, zone] of [
    [A, /Your time zone: New York \(GMT−[45]\)/],
    [B, /Your time zone: Tokyo \(GMT\+9\)/],
  ] as const) {
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator(".poll-zone")).toHaveText(zone);
    const labels = await Promise.all(
      slots.map((slot) => labelIn(page, slot.ms)),
    );
    await expect(card(page).locator(".poll-option-text")).toHaveText(labels);
  }
  // The same option reads differently in the two zones.
  expect(await labelIn(A, thursday.ms)).not.toBe(await labelIn(B, thursday.ms));

  // ---- Votes: Bea picks Thursday, Ada Thursday and Friday; each sees the
  // other's live.
  const option = async (page: Page, slot: Slot, rest: string) =>
    card(page).getByRole("checkbox", {
      name: new RegExp(`^${escaped(await labelIn(page, slot.ms))}, ${rest}`),
    });
  await focus(B);
  await (await option(B, thursday, "0 votes")).click();
  await expect(await option(B, thursday, "1 vote, your vote")).toBeVisible();
  await expect(
    await option(A, thursday, "1 vote"),
    "Ada sees Bea's vote live",
  ).toBeVisible();
  await focus(A);
  await (await option(A, thursday, "1 vote")).click();
  await expect(await option(A, thursday, "2 votes, your vote")).toBeVisible();
  await (await option(A, friday, "0 votes")).click();
  await expect(await option(A, friday, "1 vote, your vote")).toBeVisible();

  // ---- Closing: the line names the winning time in each reader's zone.
  await card(A).locator(".poll-close").click();
  await A.locator(".poll-confirm .primary").click();
  const closing = (page: Page) =>
    page.locator(".system-row", { hasText: "closed the poll" });
  for (const page of [A, B]) {
    await expect(closing(page)).toContainText(
      `Winner: ${await phraseIn(page, thursday.ms)}, 2 votes`,
    );
    await expect(card(page)).toContainText("Closed");
    await expect(card(page).locator(".poll-zone")).toBeVisible();
  }

  // ---- /when with words opens the same form with the question; one
  // time alone does not post.
  await composer.click();
  await composer.pressSequentially("/when Game night?");
  const options = A.locator(".command-list .command-option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("/when");
  await expect(options.first()).toContainText("Find a time");
  await A.keyboard.press("Escape");
  await A.keyboard.press("Enter");
  await expect(form, "sending /when opens the form").toBeVisible();
  await expect(question).toHaveValue("Game night?");
  await expect(composer, "the command's words leave the field").toHaveText("");
  await expect(
    time(1),
    "with a question, the first time is next",
  ).toBeFocused();
  await pick(A, time(1), friday, "21:30");
  await expect(post, "one time is not a poll").toBeDisabled();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await expect(card(A).locator(".poll-option")).toHaveCount(3);
});

test("a key in an open panel never posts a stale time; passed times", async ({
  browser,
}) => {
  const { tokens, channels } = await seed({ channels: ["general"] });
  const A = await (
    await browser.newContext({ timezoneId: "America/New_York" })
  ).newPage();
  await signIn(A, tokens.ada);
  await channelLink(A, "general").click();
  await expect(A.locator(COMPOSER)).toBeVisible();

  const QUESTION = "Late night?";
  const form = A.getByRole("dialog", { name: "Find a time" });
  const panel = A.getByRole("dialog", { name: "Pick a date and time" });
  const time = (n: number) =>
    form.getByRole("button", { name: `Time ${n}`, exact: true });
  const thursday = await slotFromNow(A, 3, 19);
  const friday = await slotFromNow(A, 4, 20);
  const fridayLate = await slotFromNow(A, 4, 21);

  await A.getByRole("button", { name: "Find a time" }).click();
  await form.getByRole("textbox", { name: "Question" }).fill(QUESTION);
  await pick(A, time(1), thursday, "19:00");
  await pick(A, time(2), friday, "20:00");

  // Cmd or Ctrl with Enter in an open panel settles its time and closes
  // it; it does not post the time as it was before the keystroke.
  await time(2).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "Time" }).fill("21:00");
  await A.keyboard.press("ControlOrMeta+Enter");
  await expect(panel).toHaveCount(0);
  await expect(form, "nothing is posted from the panel").toBeVisible();
  await expect(time(2)).toHaveText(await labelIn(A, fridayLate.ms));
  await A.keyboard.press("ControlOrMeta+Enter");
  await expect(form).toHaveCount(0);

  const card = A.locator(".poll-row", { hasText: QUESTION });
  await expect(card.locator(".poll-option-text")).toHaveText([
    await labelIn(A, thursday.ms),
    await labelIn(A, fridayLate.ms),
  ]);

  // Thursday's time goes by (the page's clock moved past it). The card
  // marks it at its next redraw, here a vote, and it still takes votes.
  const option = async (slot: Slot) =>
    card.getByRole("checkbox", {
      name: new RegExp(`^${escaped(await labelIn(A, slot.ms))}`),
    });
  await expect(card.locator(".poll-option.passed")).toHaveCount(0);
  await A.clock.setFixedTime(new Date(thursday.ms + 60 * 60_000));
  await (await option(fridayLate)).click();
  await expect(card.locator(".poll-option.passed")).toHaveCount(1);
  await expect(await option(thursday)).toHaveAccessibleName(
    /, passed, 0 votes$/,
  );
  await (await option(thursday)).click();
  await expect(await option(thursday)).toHaveAccessibleName(
    /, passed, 1 vote, your vote$/,
  );

  // Closed, nothing is marked passed.
  await card.locator(".poll-close").click();
  await A.locator(".poll-confirm .primary").click();
  await expect(card).toContainText("Closed");
  await expect(card.locator(".poll-option.passed")).toHaveCount(0);
  await expect(card.getByText("Passed", { exact: true })).toHaveCount(0);

  // A text poll is never marked.
  const made = await A.request.post("/stoop.chat.v1.ChatService/CreatePoll", {
    headers: { authorization: `Bearer ${tokens.ada}` },
    data: {
      channelId: channels.general,
      question: "Pizza or tacos?",
      options: ["Pizza", "Tacos"],
    },
  });
  expect(made.ok()).toBe(true);
  const text = A.locator(".poll-row", { hasText: "Pizza or tacos?" });
  await text.getByRole("radio", { name: /^Pizza/ }).click();
  await expect(
    text.getByRole("radio", { name: /^Pizza, 1 vote, your vote$/ }),
  ).toBeVisible();
  await expect(text.locator(".poll-option.passed")).toHaveCount(0);
});

// STOOP-561: a click on the page behind the form, with a panel open,
// used to close the form too and lose what was typed.
test("a click outside the form closes an open panel first, then the form", async ({
  browser,
}) => {
  const { tokens } = await seed({ channels: ["general"] });
  const A = await (
    await browser.newContext({ timezoneId: "America/New_York" })
  ).newPage();
  await signIn(A, tokens.ada);
  await channelLink(A, "general").click();
  await expect(A.locator(COMPOSER)).toBeVisible();

  const QUESTION = "Board game night?";
  const form = A.getByRole("dialog", { name: "Find a time" });
  const question = form.getByRole("textbox", { name: "Question" });
  const panel = A.getByRole("dialog", { name: "Pick a date and time" });
  const first = form.getByRole("button", { name: "Time 1", exact: true });
  const thursday = await slotFromNow(A, 3, 19);
  const thursdayLate = await slotFromNow(A, 3, 21);
  // A point on the dimmed page, clear of the form and the panel.
  const outside = () => A.mouse.click(5, 5);

  await A.getByRole("button", { name: "Find a time" }).click();
  await question.fill(QUESTION);
  await pick(A, first, thursday, "19:00");

  // The panel open and a time typed: the click settles the time and
  // closes the panel, as a click inside the form does, and no more.
  await first.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "Time" }).fill("21:00");
  await outside();
  await expect(panel).toHaveCount(0);
  await expect(form, "the form stays open").toBeVisible();
  await expect(question, "with what was typed").toHaveValue(QUESTION);
  await expect(first, "and the typed time taken").toHaveText(
    await labelIn(A, thursdayLate.ms),
  );
  // Focus is back on the field, not left on the page, so the form's own
  // keys still work: Tab stays in the form.
  await expect(first, "focus goes back to the field").toBeFocused();
  await A.keyboard.press("Shift+Tab");
  expect(
    await form.evaluate((box) => box.contains(document.activeElement)),
    "Shift+Tab stays in the form",
  ).toBe(true);

  // A right-click outside closes the panel and ends in no click; the
  // form's own buttons still answer the click after it.
  await first.click();
  await expect(panel).toBeVisible();
  await A.mouse.click(5, 5, { button: "right" });
  await expect(panel).toHaveCount(0);
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Add time" }).click();
  await expect(form.getByText("3 of 10")).toBeVisible();

  // Only a press on the form's own scrim is held back. Something drawn
  // over the form (a confirm or a notice raised while a panel is open)
  // hears its first click: a stand-in button over the page here.
  await first.click();
  await expect(panel).toBeVisible();
  await A.evaluate(() => {
    const over = document.createElement("button");
    over.id = "over-the-form";
    over.textContent = "OK";
    over.style.cssText = "position:fixed;top:0;left:0;z-index:99999";
    over.addEventListener("click", () => over.setAttribute("data-clicked", ""));
    document.body.append(over);
  });
  await A.mouse.click(5, 5);
  await expect(panel).toHaveCount(0);
  await expect(A.locator("#over-the-form")).toHaveAttribute("data-clicked", "");
  await A.evaluate(() => document.getElementById("over-the-form")?.remove());

  // With no panel open, a click outside closes the form as before.
  await outside();
  await expect(form).toHaveCount(0);
});
