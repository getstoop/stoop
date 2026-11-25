import type { Locator } from "@playwright/test";
import { COMPOSER, expect, rowByText, say, seed, signIn, test } from "./lib";

// Slash commands (STOOP-551): "/" and letters as the whole draft opens the
// command list, which filters, picks by keyboard and closes on Escape;
// /poll opens the poll form with the words after it as the question and
// posts nothing; an unknown /word is sent as typed; a thread's composer
// has no list and sends a command as text. What counts as a command is
// core/commands.test.ts. Typed a key at a time: the list opens per
// keystroke, which one fill() would skip.
test("the command list and /poll", async ({ browser }) => {
  const { tokens } = await seed({ users: ["ada"], channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);

  const composer = A.locator(COMPOSER);
  const list = A.locator(".command-list");
  const options = list.locator(".command-option");
  const form = A.getByRole("dialog", { name: "Create a poll" });
  // Where focus is, asked of the page: nothing here focuses it first.
  const focusInComposer = () =>
    expect
      .poll(() =>
        A.evaluate(
          () =>
            document.activeElement?.closest(".channel-view .composer") != null,
        ),
      )
      .toBe(true);
  // Sends a message and waits for it, so that anything an earlier step
  // might have posted has had the time to show.
  const marker = async (text: string) => {
    await say(A, text);
    await expect(rowByText(A, text)).toHaveCount(1);
  };
  await expect(composer).toBeVisible();
  await say(A, "Friday is on. What are we playing?");
  const root = rowByText(A, "Friday is on");
  await expect(root).toHaveCount(1);

  // Opened from the poll button and cancelled, focus goes back to the
  // button, as for any dialog.
  const pollButton = A.getByRole("button", { name: "Create a poll" });
  await pollButton.click();
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await expect(pollButton, "button-opened cancel returns to it").toBeFocused();

  // A lone "/" opens the list, the first entry selected and marked by
  // more than colour.
  await composer.click();
  await composer.pressSequentially("/");
  await expect(options, "a lone slash lists /poll").toHaveCount(1);
  await expect(options.first()).toContainText("/poll");
  await expect(options.first()).toContainText("[question]");
  await expect(options.first()).toContainText("Create a poll");
  await expect(options.first(), "the first entry is selected").toHaveClass(
    /selected/,
  );
  await expect(
    options.first().locator(".command-key"),
    "and carries the Enter keycap",
  ).toHaveText("Enter");
  await A.keyboard.press("ArrowDown");
  await expect(
    options.first(),
    "ArrowDown with one entry stays on it",
  ).toHaveClass(/selected/);

  // Letters filter; a letter nothing starts with closes the list.
  await composer.pressSequentially("po");
  await expect(options, '"/po" still lists /poll').toHaveCount(1);
  await composer.pressSequentially("x");
  await expect(composer).toHaveText("/pox");
  await expect(list, '"/pox" matches nothing').toHaveCount(0);
  await A.keyboard.press("Backspace");
  await expect(options, "deleting the letter brings it back").toHaveCount(1);

  // Escape closes and keeps the text, and the list stays shut while the
  // draft is still a command; emptied, the draft opens it again.
  await A.keyboard.press("Escape");
  await expect(list, "Escape closes the list").toHaveCount(0);
  await expect(composer, "and keeps the text").toHaveText("/po");
  await composer.pressSequentially("l");
  await expect(composer).toHaveText("/pol");
  await expect(list, "typing on leaves it shut").toHaveCount(0);
  for (let i = 0; i < 4; i++) await A.keyboard.press("Backspace");
  await expect(composer).toHaveText("");
  await composer.pressSequentially("/pol");
  await expect(options, "a new draft opens it again").toHaveCount(1);

  // Tab picks: the form opens empty, the command's words leave the field.
  await A.keyboard.press("Tab");
  await expect(form, "Tab opens the poll form").toBeVisible();
  await expect(form.getByRole("textbox", { name: "Question" })).toHaveValue("");
  await expect(
    form.getByRole("textbox", { name: "Question" }),
    "with the question focused",
  ).toBeFocused();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await expect(composer, "cancelling does not bring the words back").toHaveText(
    "",
  );
  await focusInComposer();

  // /poll and a question, with a reply pending: Enter opens the form with
  // the question as plain words. The reply stays for the next message.
  await root.hover();
  await root.locator('.message-action[aria-label="Reply"]').click();
  await expect(A.locator(".reply-bar")).toBeVisible();
  await composer.pressSequentially("/poll What are we playing on Friday?");
  await expect(
    options,
    "after a space the list stays on the one command",
  ).toHaveCount(1);
  // A list of one leaves the arrows to the caret.
  await A.keyboard.press("ArrowUp");
  await expect
    .poll(
      () => A.evaluate(() => window.getSelection()?.anchorOffset),
      "ArrowUp moves the caret, not the selection",
    )
    .toBe(0);
  await expect(options).toHaveCount(1);
  await A.keyboard.press("Enter");
  await expect(form, "Enter opens the poll form").toBeVisible();
  await expect(
    form.getByRole("textbox", { name: "Question" }),
    "with the typed question",
  ).toHaveValue("What are we playing on Friday?");
  await expect(
    form.getByRole("textbox", { name: "Option 1" }),
    "and the first option focused",
  ).toBeFocused();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await focusInComposer();
  await expect(composer, "the command's words are gone").toHaveText("");
  await expect(A.locator(".reply-bar"), "the reply stays").toBeVisible();
  await A.locator('.reply-bar [aria-label="Cancel reply"]').click();
  await marker("marker one");
  await expect(
    rowByText(A, "What are we playing on Friday?"),
    "nothing was posted",
  ).toHaveCount(0);

  // Escape shuts the list for the rest of the question; sent, /poll still
  // opens the form, and Escape there gives focus back to the words.
  await composer.click();
  await composer.pressSequentially("/poll Pizza");
  await A.keyboard.press("Escape");
  await composer.pressSequentially(" or tacos?");
  await expect(composer).toHaveText("/poll Pizza or tacos?");
  await expect(list, "the list stays shut").toHaveCount(0);
  await A.keyboard.press("Enter");
  await expect(form, "sending /poll opens the form").toBeVisible();
  await expect(form.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Pizza or tacos?",
  );
  await A.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await focusInComposer();

  // Picked from the list, the words are read as a send reads them: a
  // shortcode is its emoji.
  await composer.pressSequentially("/poll Pizza :pizza: ok");
  await expect(composer).toHaveText("/poll Pizza :pizza: ok");
  await expect(options).toHaveCount(1);
  await A.keyboard.press("Enter");
  await expect(form.getByRole("textbox", { name: "Question" })).toHaveValue(
    "Pizza 🍕 ok",
  );
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await marker("marker two");
  await expect(rowByText(A, "Pizza or tacos?")).toHaveCount(0);
  await expect(rowByText(A, "Pizza 🍕 ok")).toHaveCount(0);

  // An unknown /word is an ordinary message.
  await composer.click();
  await composer.pressSequentially("/shrug");
  await expect(composer).toHaveText("/shrug");
  await expect(list, "an unknown word lists nothing").toHaveCount(0);
  await A.keyboard.press("Enter");
  await expect(rowByText(A, "/shrug"), "/shrug is sent as typed").toHaveCount(
    1,
  );
  await expect(form).toHaveCount(0);

  // In a thread the list never opens, and /poll is sent as text.
  await root.hover();
  await root.locator('.message-action[aria-label="Reply in thread"]').click();
  const panel = A.locator(".side-panel");
  const threadComposer: Locator = panel.locator(
    ".composer .rich-editor-content",
  );
  await expect(threadComposer).toBeVisible();
  await threadComposer.click();
  await threadComposer.pressSequentially("/");
  await expect(threadComposer).toHaveText("/");
  await expect(list, "no list in a thread").toHaveCount(0);
  await threadComposer.pressSequentially("poll Co-op or racing?");
  await expect(threadComposer).toHaveText("/poll Co-op or racing?");
  await expect(list).toHaveCount(0);
  // Enter sends rather than picks, which is what shows the list was shut.
  await A.keyboard.press("Enter");
  await expect(
    panel.locator(".message-content", { hasText: "/poll Co-op or racing?" }),
    "a thread sends /poll as typed",
  ).toHaveCount(1);
  await expect(form).toHaveCount(0);
});
