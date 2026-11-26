import type { Locator, Page } from "@playwright/test";
import {
  acceptDialog,
  COMPOSER,
  expect,
  reminderTimeComes,
  rowByText,
  say,
  seed,
  signIn,
  test,
  waitingReminders,
  waitingReminderTimes,
} from "./lib";

// A time as the page words it on a notice ("4:30 PM").
const shownTime = (page: Page, time: Date) =>
  page.evaluate(
    (ms) =>
      new Date(ms).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    time.getTime(),
  );

// Reminders on web (STOOP-554): /remind in the command list beside /poll,
// the form (text, four presets, a picked date and time, the past-time
// error), the notice with Undo, and a reminder posted for someone else to
// see, with Delete for whoever set it and for a moderator only. The form's
// rules and the wording of times are core/reminderForm.test.ts. A
// reminder's time is not waited for: reminderTimeComes (lib.ts) moves the
// stored time and the delivery sweep's next run to now, and the server
// delivers it as it would at its time.
test("set, undo, and a reminder posted for the channel", async ({
  browser,
}) => {
  // Ada is the space's owner, so a moderator; Bea sets the reminders; Cal
  // is a member with no say over them.
  const { tokens, channels } = await seed({
    users: ["ada", "bea", "cal"],
    channels: ["general"],
  });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  const C = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await signIn(B, tokens.bea);
  await signIn(C, tokens.cal);

  const composer = B.locator(COMPOSER);
  const options = B.locator(".command-list .command-option");
  const form = B.getByRole("dialog", { name: "Set a reminder" });
  const text = form.getByRole("textbox", { name: "Reminder" });
  const set = form.getByRole("button", { name: "Set reminder" });
  const when = (name: string | RegExp) => form.getByRole("radio", { name });
  const picked = form.getByLabel("Date and time", { exact: true });
  const panel = B.getByRole("dialog", { name: "Pick a date and time" });
  const grid = panel.locator(".date-time-grid");
  const timeBox = panel.getByRole("textbox", { name: "Time" });
  const done = panel.getByRole("button", { name: "Done" });
  const notice = B.locator(".transient-notice");
  const undo = notice.getByRole("button", { name: "Undo" });
  const fired = (page: Page, words: string) =>
    page.locator(".reminder-row", { hasText: words });
  // A moment from now in the page's own zone (years, then ms, then
  // calendar days added, the order customBounds builds the form's bounds
  // in): its day, its month, its time and its full name as the panel's
  // grid says it.
  type From = { years?: number; ms?: number; days?: number };
  const local = (from: From) =>
    B.evaluate(({ years = 0, ms = 0, days = 0 }) => {
      const d = new Date(Date.now());
      d.setFullYear(d.getFullYear() + years);
      d.setTime(d.getTime() + ms);
      d.setDate(d.getDate() + days);
      const pad = (value: number) => String(value).padStart(2, "0");
      const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return {
        month,
        day: `${month}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        name: d.toLocaleDateString([], {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      };
    }, from);
  // The grid's button for a day from now, the panel turned to its month
  // with the arrows, or null when the arrow toward it is off (the month
  // is outside the bounds). The date is never typed: it is picked from
  // the grid.
  const dayFromNow = async (from: From) => {
    const target = await local(from);
    if ((await panel.count()) === 0) await picked.click();
    for (let turns = 0; turns < 14; turns++) {
      const shown = (await grid.getAttribute("data-month")) ?? "";
      if (shown === target.month) break;
      const arrow = panel.getByRole("button", {
        name: shown < target.month ? "Next month" : "Previous month",
      });
      if (await arrow.isDisabled()) return null;
      await arrow.click();
    }
    await expect(grid).toHaveAttribute("data-month", target.month);
    return grid.getByRole("button", { name: target.name, exact: true });
  };
  // A day from now that can't be chosen: off in the grid, or in a month
  // the arrows don't reach.
  const offLimits = async (from: From) => {
    const day = await dayFromNow(from);
    if (day) await expect(day).toBeDisabled();
  };
  // Picks a day from now and a time (that moment's own, unless given),
  // typed as 24-hour, and closes the panel with Done. Returns the value
  // the form now holds.
  const pick = async (from: From, time?: string) => {
    const target = await local(from);
    const day = await dayFromNow(from);
    expect(day, "the day's month is in reach").not.toBeNull();
    await day?.click();
    const at = time ?? target.time;
    await timeBox.fill(at);
    await done.click();
    await expect(panel).toHaveCount(0);
    return `${target.day}T${at}`;
  };
  const DAY_MS = 24 * 60 * 60_000;
  await expect(composer).toBeVisible();

  // ---- The list: both commands, and the arrows move between them.
  await composer.click();
  await composer.pressSequentially("/");
  await expect(options, "a lone slash lists both commands").toHaveCount(2);
  await expect(options.nth(1)).toContainText("/remind");
  await expect(options.nth(1)).toContainText("[what]");
  await expect(options.nth(1)).toContainText("Set a reminder here");
  await B.keyboard.press("ArrowDown");
  await expect(options.nth(1), "ArrowDown moves to /remind").toHaveClass(
    /selected/,
  );
  await B.keyboard.press("ArrowDown");
  await expect(options.nth(0), "and wraps back to /poll").toHaveClass(
    /selected/,
  );
  await B.keyboard.press("ArrowUp");
  await expect(options.nth(1), "ArrowUp goes the other way").toHaveClass(
    /selected/,
  );
  await B.keyboard.press("Enter");
  await expect(form, "picking /remind opens the form").toBeVisible();
  await expect(text).toHaveValue("");
  await expect(set, "Set reminder is off on an empty form").toBeDisabled();
  for (const name of [
    "In 20 minutes",
    "In 1 hour",
    "In 3 hours",
    /^Tomorrow at/,
    "Pick a date and time",
  ])
    await expect(when(name), "nothing is chosen").not.toBeChecked();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await expect(composer, "the command's words are gone").toHaveText("");

  // ---- /remind and words: the form opens with them as the text.
  await composer.click();
  await composer.pressSequentially("/remind Order the pizza before seven");
  await expect(options).toHaveCount(1);
  await B.keyboard.press("Escape");
  await B.keyboard.press("Enter");
  await expect(form, "sending /remind opens the form").toBeVisible();
  await expect(text).toHaveValue("Order the pizza before seven");
  // Each preset says when it lands.
  await expect(
    form.locator(".reminder-when-option", { hasText: "In 1 hour" }),
  ).toContainText(/(Today|Tomorrow) at/);
  await when("In 1 hour").check();
  await expect(set, "a preset and text: on").toBeEnabled();

  // A picked date and time: the kit's own field and panel, bounded by
  // day, and a time gone by said in words.
  await when("Pick a date and time").check();
  await expect(picked).toBeVisible();
  await expect(picked).toHaveText("Pick a date and time");
  await expect(
    form.getByText("From a minute to a year from now."),
  ).toBeVisible();
  await expect(set, "no time picked yet: off").toBeDisabled();
  await picked.click();
  await expect(panel).toBeVisible();
  // The panel is fixed on the layer over the dialog, so the dialog's
  // clipping does not cut it: the point at its foot is the panel's.
  expect(
    await panel.evaluate((box) => {
      const rect = box.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + 8, rect.bottom - 4);
      return getComputedStyle(box).position === "fixed" && box.contains(hit);
    }),
    "the panel is whole, over the dialog",
  ).toBe(true);
  // Bounds by day, as customBounds sets them: from a day before now to a
  // calendar year and a day ahead. The day of the lower bound is allowed
  // (the form's own check refuses a past time), the day before it and
  // the day after the upper bound are not. Tried again should a day turn
  // over in the middle.
  await expect(async () => {
    const earliest = await dayFromNow({ ms: -DAY_MS });
    expect(earliest).not.toBeNull();
    await expect(earliest as Locator).toBeEnabled({ timeout: 1000 });
    await offLimits({ ms: -DAY_MS, days: -1 });
    await offLimits({ years: 1, ms: DAY_MS, days: 1 });
  }).toPass({ timeout: 10_000 });
  await B.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // Escape and Tab hold wherever focus is while the panel is open: after
  // a click on a dimmed day or on the panel's own ground, Escape still
  // closes only the panel, and the form keeps its text.
  await picked.click();
  await expect(panel).toBeVisible();
  const dimmed = grid.locator("button:disabled");
  if ((await dimmed.count()) > 0) await dimmed.first().click({ force: true });
  await panel.click({ position: { x: 6, y: 6 } });
  await B.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(form, "the form stays open").toBeVisible();
  await expect(text, "with its text").toHaveValue(
    "Order the pizza before seven",
  );
  await expect(picked).toBeFocused();
  // Tab goes round the panel's few stops and never out of it, from a
  // click on its ground too, and the days are one stop, not thirty.
  await picked.click();
  await expect(panel).toBeVisible();
  await panel.click({ position: { x: 6, y: 6 } });
  const stops = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await B.keyboard.press("Tab");
    stops.add(
      await B.evaluate(() => {
        const at = document.activeElement as HTMLElement | null;
        if (!at?.closest(".date-time-panel")) return "outside";
        if (at.classList.contains("date-time-panel")) return "panel";
        return at.dataset.day ? "day" : at.getAttribute("aria-label") || "";
      }),
    );
  }
  expect(stops.has("outside"), "Tab stays in the panel").toBe(false);
  expect(stops.has("day"), "Tab reaches the day").toBe(true);
  expect(stops.has("Time"), "and the time").toBe(true);
  expect(stops.has("panel"), "and moves on from the ground").toBe(false);
  expect(stops.size, "a handful of stops").toBeLessThanOrEqual(4);
  // Escape closes the panel alone, not the form, and puts focus back.
  await B.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(form, "Escape in the panel leaves the form").toBeVisible();
  await expect(picked).toBeFocused();
  await expect(picked, "and nothing was chosen").toHaveText(
    "Pick a date and time",
  );

  await pick({ ms: -60 * 60_000 });
  // Said as a caution: this device's clock may be ahead of the
  // server's, which decides, so it stops nothing.
  await expect(
    form.getByText(
      "That time has passed by this device's clock. Pick one at least a minute from now.",
    ),
  ).toBeVisible();
  await expect(picked).not.toHaveAttribute("aria-invalid", "true");
  await expect(set, "a past time is still sent").toBeEnabled();

  // By keyboard: the panel opens on the chosen day, Down moves a week,
  // Enter chooses it and goes to the time, and Enter in the time closes
  // the panel without sending the form.
  let sent = 0;
  B.on("request", (request) => {
    if (request.url().includes("/CreateReminder")) sent++;
  });
  await picked.focus();
  await B.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  const focusedDay = () =>
    B.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.day ?? "",
    );
  await expect
    .poll(focusedDay, "focus goes to the chosen day")
    .toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const chosenDay = await focusedDay();
  await B.keyboard.press("ArrowDown");
  const weekOn = await B.evaluate((day) => {
    const d = new Date(`${day}T12:00`);
    d.setDate(d.getDate() + 7);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, chosenDay);
  await expect.poll(focusedDay, "Down moves a week").toBe(weekOn);
  await B.keyboard.press("Enter");
  await expect(timeBox).toBeFocused();
  await timeBox.fill("7:75");
  await B.keyboard.press("Enter");
  await expect(
    panel.getByText(/^That isn't a time\. Try /),
    "a typed time that isn't one is said",
  ).toBeVisible();
  await expect(done).toBeDisabled();
  await timeBox.fill("21:15");
  await B.keyboard.press("Enter");
  await expect(panel).toHaveCount(0);
  await expect(form, "Enter in the time does not send the form").toBeVisible();
  await expect(picked, "the field shows the time typed").toContainText(
    await B.evaluate(() =>
      new Date(2000, 0, 1, 21, 15).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    ),
  );
  expect(sent).toBe(0);
  expect(await waitingReminders()).toBe(0);
  // A typed time is taken when it is settled, never per keystroke. One
  // that isn't a time, left by a press outside the panel (here on the
  // field, since the panel may cover the rest of the form above it), is
  // dropped: the field keeps the last time taken.
  const clock = (hour: number, minute: number) =>
    B.evaluate(
      ([h, m]) =>
        new Date(2000, 0, 1, h, m).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      [hour, minute],
    );
  const typeTime = async (typed: string) => {
    await timeBox.fill("");
    await timeBox.pressSequentially(typed);
  };
  const shownBefore = (await picked.textContent()) ?? "";
  await picked.click();
  await typeTime("7:75");
  await picked.click();
  await expect(panel).toHaveCount(0);
  await expect(picked, "an invalid typed time is dropped").toHaveText(
    shownBefore,
  );
  // A real one, left the same way, is taken.
  await picked.click();
  await typeTime("8pm");
  await picked.click();
  await expect(panel).toHaveCount(0);
  await expect(picked, "a typed time is taken on leaving").toContainText(
    await clock(20, 0),
  );
  // Escape puts back the value the panel opened with, even after a real
  // time was typed, and leaves the form open.
  const beforeEscape = (await picked.textContent()) ?? "";
  await picked.click();
  await typeTime("6:45");
  await B.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(picked, "Escape takes nothing typed").toHaveText(beforeEscape);
  // Up and Down step from the time typed, not the one taken before.
  await picked.click();
  await typeTime("3pm");
  await timeBox.press("ArrowDown");
  await expect(timeBox).toHaveValue(await clock(15, 30));
  await B.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(picked, "and Escape puts that back too").toHaveText(
    beforeEscape,
  );
  await expect(
    form.getByText("From a minute to a year from now."),
  ).toBeVisible();
  await expect(set, "a week ahead: on").toBeEnabled();

  // ---- Set: the request names the preset and the zone and no instant;
  // the notice says the time the server stored, and nothing is posted.
  const zone = await B.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  await when("In 20 minutes").check();
  const presetSent = B.waitForRequest(
    "**/stoop.chat.v1.ChatService/CreateReminder",
  );
  await set.click();
  expect((await presetSent).postDataJSON()).toEqual({
    channelId: channels.general,
    text: "Order the pizza before seven",
    preset: "REMINDER_PRESET_IN_20_MINUTES",
    timeZone: zone,
  });
  await expect(form).toHaveCount(0);
  await expect(notice).toContainText(/^Reminder set for (today|tomorrow) at /);
  await expect(notice, "the time as the server stored it").toContainText(
    await shownTime(B, (await waitingReminderTimes())[0]),
  );
  await expect(
    B.locator(".transient-notice-region [role=status]"),
    "the live region holds the words alone",
  ).toHaveText(/^Reminder set for (today|tomorrow) at [^U]*$/);
  await expect(undo).toBeVisible();

  // The composer's lists open over the notice and stay whole: the point
  // at the bottom of each list's last row is that row.
  const lastRowOnTop = (list: string) =>
    B.locator(`${list} .option`)
      .last()
      .evaluate((row) => {
        const box = row.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + 24, box.bottom - 3);
        return !!hit && row.contains(hit);
      });
  await composer.pressSequentially("/");
  await expect(options).toHaveCount(2);
  expect(await lastRowOnTop(".command-list"), "the command list").toBe(true);
  await B.keyboard.press("Backspace");
  await composer.pressSequentially("@");
  await expect(B.locator(".mention-picker .option").first()).toBeVisible();
  expect(await lastRowOnTop(".mention-picker"), "the mention list").toBe(true);
  await B.keyboard.press("Backspace");
  await expect(composer).toHaveText("");
  expect(await waitingReminders()).toBe(1);
  await say(B, "marker one");
  await expect(rowByText(B, "marker one")).toHaveCount(1);
  await expect(
    fired(B, "Order the pizza"),
    "setting one posts nothing",
  ).toHaveCount(0);

  // ---- Undo takes it back, and the notice says so.
  await undo.click();
  await expect(notice).toHaveText("Reminder removed");
  await expect(undo).toHaveCount(0);
  await expect.poll(waitingReminders).toBe(0);
  await B.mouse.move(0, 0);
  await expect(notice, "then it goes on its own").toHaveCount(0, {
    timeout: 10_000,
  });

  // ---- Set again, and let its time come: Ada sees it posted.
  await composer.click();
  await composer.pressSequentially("/remind Order the pizza before seven");
  await B.keyboard.press("Escape");
  await B.keyboard.press("Enter");
  // A picked time goes as the field holds it, with the zone: a day in
  // another month, reached with the month arrows.
  await when("Pick a date and time").check();
  const pickedValue = await pick({ days: 35 }, "10:30");
  const pickedSent = B.waitForRequest(
    "**/stoop.chat.v1.ChatService/CreateReminder",
  );
  await set.click();
  expect((await pickedSent).postDataJSON()).toEqual({
    channelId: channels.general,
    text: "Order the pizza before seven",
    localTime: pickedValue,
    timeZone: zone,
  });
  await expect(undo).toBeVisible();
  await expect(notice).toContainText(
    await shownTime(B, (await waitingReminderTimes())[0]),
  );
  await B.mouse.move(0, 0);
  await expect(notice, "the notice goes on its own").toHaveCount(0, {
    timeout: 10_000,
  });
  await reminderTimeComes();
  const forAda = fired(A, "Order the pizza before seven");
  await expect(forAda, "posted for everyone in the channel").toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(forAda).toContainText(/^Reminder from bea/);
  await expect(fired(B, "Order the pizza before seven")).toHaveCount(1);
  await expect.poll(waitingReminders).toBe(0);

  // Delete: Ada as a moderator and Bea who set it; never Cal.
  await forAda.hover();
  await expect(forAda.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(
    forAda.locator(".message-action"),
    "Delete is the only action",
  ).toHaveCount(1);
  const forCal = fired(C, "Order the pizza before seven");
  await expect(forCal).toHaveCount(1);
  await forCal.hover();
  await expect(
    forCal.locator(".message-action"),
    "another member gets no action",
  ).toHaveCount(0);

  // ---- Undo after it was posted: the notice says so. Held on screen by
  // the pointer while the time comes.
  await composer.click();
  await composer.pressSequentially("/remind Book the cabin");
  await B.keyboard.press("Escape");
  await B.keyboard.press("Enter");
  await when("In 1 hour").check();
  // Enter in the text sets it.
  await text.press("Enter");
  await expect(form).toHaveCount(0);
  await notice.hover();
  await reminderTimeComes();
  await expect(fired(B, "Book the cabin")).toHaveCount(1, { timeout: 20_000 });
  await expect(notice, "held while pointed at").toBeVisible();
  await undo.click();
  await expect(notice).toHaveText("That reminder has already been posted");

  // ---- A late answer closes only the form that sent it: the first
  // form is closed while its request is out, a second is opened with its
  // words, and only then is the first answer let through.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await B.route(
    "**/stoop.chat.v1.ChatService/CreateReminder",
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await composer.click();
  await composer.pressSequentially("/remind first");
  await B.keyboard.press("Enter");
  await when("In 1 hour").check();
  await set.click();
  await expect(form.getByRole("button", { name: "Setting…" })).toBeDisabled();
  await B.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await composer.pressSequentially("/remind second thoughts");
  await B.keyboard.press("Enter");
  await expect(text).toHaveValue("second thoughts");
  await expect(notice).not.toContainText(/^Reminder set for/);
  release();
  await expect(notice, "the first answer still gets its notice").toContainText(
    /^Reminder set for/,
  );
  await expect(form, "and leaves the second form open").toBeVisible();
  await expect(text).toHaveValue("second thoughts");
  await form.getByRole("button", { name: "Cancel" }).click();
  await B.unroute("**/stoop.chat.v1.ChatService/CreateReminder");

  // Bea deletes the one she set, and it goes for everyone.
  const forBea = fired(B, "Order the pizza before seven");
  await forBea.hover();
  await forBea.getByRole("button", { name: "Delete" }).click();
  await acceptDialog(B);
  await expect(forBea).toHaveCount(0);
  await expect(forAda, "gone for Ada too").toHaveCount(0);
});

// The server's clock decides: a device whose clock is hours off still
// sets a preset from the server's now, and the notice shows the time the
// server stored, not one the device worked out.
test("a preset follows the server's clock", async ({ browser }) => {
  const { tokens } = await seed({ users: ["ada"], channels: ["general"] });
  const B = await (await browser.newContext()).newPage();
  const behind = 6 * 60 * 60_000;
  await B.clock.install({ time: new Date(Date.now() - behind) });
  await signIn(B, tokens.ada);
  const lag = Date.now() - (await B.evaluate(() => Date.now()));
  expect(lag, "the page's clock is hours behind").toBeGreaterThan(
    behind - 60_000,
  );
  const composer = B.locator(COMPOSER);
  await composer.click();
  await composer.pressSequentially("/remind Feed the cat");
  await B.keyboard.press("Escape");
  await B.keyboard.press("Enter");
  const form = B.getByRole("dialog", { name: "Set a reminder" });
  await form.getByRole("radio", { name: "In 1 hour" }).check();
  const asked = Date.now();
  await form.getByRole("button", { name: "Set reminder" }).click();
  const notice = B.locator(".transient-notice");
  await expect(notice).toContainText(/^Reminder set for /);
  const [stored] = await waitingReminderTimes();
  // An hour from the server's now, rounded down to the minute.
  expect(Math.abs(stored.getTime() - (asked + 60 * 60_000))).toBeLessThan(
    2 * 60_000,
  );
  await expect(notice).toContainText(await shownTime(B, stored));
  // Not the time the device would have worked out for itself.
  await expect(notice).not.toContainText(
    await shownTime(B, new Date(stored.getTime() - behind)),
  );
});
