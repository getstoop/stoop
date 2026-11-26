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
    form.getByText("This time is already in the list."),
    "the same time twice is refused",
  ).toBeVisible();
  await expect(time(2)).toHaveAttribute("aria-invalid", "true");
  await expect(post).toBeDisabled();
  await pick(A, time(2), friday, "20:00");
  await expect(form.getByText("This time is already in the list.")).toHaveCount(
    0,
  );
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
