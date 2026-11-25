import type { Page } from "@playwright/test";
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
  const notice = B.locator(".transient-notice");
  const undo = notice.getByRole("button", { name: "Undo" });
  const fired = (page: Page, words: string) =>
    page.locator(".reminder-row", { hasText: words });
  // A local date and time in the page's own zone, as the field holds it.
  const localValue = (offsetMs: number) =>
    B.evaluate((offset) => {
      const d = new Date(Date.now() + offset);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }, offsetMs);
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

  // A picked date and time: the browser's own field, bounded, and a time
  // gone by said in words.
  await when("Pick a date and time").check();
  await expect(picked).toBeVisible();
  await expect(picked).toHaveAttribute("min", /T\d\d:\d\d$/);
  await expect(picked).toHaveAttribute("max", /T\d\d:\d\d$/);
  await expect(
    form.getByText("From a minute to a year from now."),
  ).toBeVisible();
  await expect(set, "no time picked yet: off").toBeDisabled();
  await picked.fill(await localValue(-60 * 60_000));
  await expect(
    form.getByText(
      "That time has passed. Pick one at least a minute from now.",
    ),
  ).toBeVisible();
  await expect(picked).toHaveAttribute("aria-invalid", "true");
  await expect(set, "a past time: off").toBeDisabled();
  await picked.fill(await localValue(2 * 24 * 60 * 60_000));
  await expect(picked).not.toHaveAttribute("aria-invalid", "true");
  await expect(set, "two days ahead: on").toBeEnabled();

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
  // A picked time goes as the field holds it, with the zone.
  await when("Pick a date and time").check();
  const pickedValue = await localValue(2 * 24 * 60 * 60_000);
  await picked.fill(pickedValue);
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
  // form is closed while its request is out, a second is opened, and the
  // first answer leaves the second open with its words.
  await B.route(
    "**/stoop.chat.v1.ChatService/CreateReminder",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
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
