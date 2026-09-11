import { expect, seed, signIn, test } from "./lib";

// Emoji shortcodes: the :query autocomplete over the composer (arrows,
// Enter, Tab, Esc), conversion on send, and the same conversion from the
// inline editor.
// Ported from web/e2e/shortcodes.mjs (STOOP-238). The composer is typed
// into a key at a time throughout — the list opens and filters per
// keystroke, which one fill() would skip.
test("emoji shortcodes and the suggestion list", async ({ browser }) => {
  const { tokens } = await seed({ users: ["ada"], channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);

  const composer = A.locator(".composer textarea");
  const options = A.locator(".emoji-suggest .mention-option");
  // The body only (attachments, cards and the edited marker also live in
  // .message-content).
  const lastMessage = A.locator(".message-content .md-lines").last();
  await expect(composer).toBeVisible();

  // Typing :so opens suggestions; the alias comes first; Enter inserts
  // the emoji.
  await composer.pressSequentially("oh no :so");
  await expect(
    options.first().locator(".emoji-suggest-emoji"),
    '":so" suggests 😭 first',
  ).toHaveText("😭");
  await expect(
    options.first().locator(".muted"),
    "and names it :sob:",
  ).toHaveText(":sob:");
  await expect(options.first(), "first suggestion is selected").toHaveClass(
    /selected/,
  );

  await A.keyboard.press("ArrowDown");
  await expect(options.nth(1), "ArrowDown moves the selection").toHaveClass(
    /selected/,
  );
  await A.keyboard.press("ArrowUp");
  await expect(options.first(), "ArrowUp moves it back").toHaveClass(
    /selected/,
  );
  await A.keyboard.press("Enter");
  await expect(composer, "Enter inserts the emoji and a space").toHaveValue(
    "oh no 😭 ",
  );
  await expect(options, "list closes after picking").toHaveCount(0);

  // Enter now sends, and the message carries the real emoji.
  await A.keyboard.press("Enter");
  await expect(lastMessage, "message sent with the emoji").toHaveText(
    "oh no 😭",
  );

  // Unpicked shortcodes convert on send; unknown ones and times stay put;
  // code spans are left alone.
  await composer.pressSequentially(
    "ship it :rocket: :crying: :nope: at 10:30:45 and `:sob:` ",
  );
  await A.keyboard.press("Escape");
  await A.keyboard.press("Enter");
  await expect(lastMessage, "send converts known shortcodes only").toHaveText(
    "ship it 🚀 😢 :nope: at 10:30:45 and :sob:",
  );

  // Tab picks too; Esc closes without inserting; a Unicode-derived name
  // works.
  await composer.pressSequentially(":loudly_cry");
  await expect(
    options.first().locator(".emoji-suggest-emoji"),
    "Unicode-derived names are suggested",
  ).toHaveText("😭");
  await A.keyboard.press("Escape");
  await expect(options, "Esc closes the list").toHaveCount(0);
  await expect(composer, "and keeps the text").toHaveValue(":loudly_cry");
  await composer.pressSequentially("i");
  await expect(options.first(), "typing on reopens the list").toHaveClass(
    /selected/,
  );
  await A.keyboard.press("Tab");
  await expect(composer, "Tab picks the highlighted suggestion").toHaveValue(
    "😭 ",
  );
  await A.keyboard.press("Enter");
  await expect(composer, "the draft clears on send").toHaveValue("");

  // Colons in ordinary text don't open the list.
  // Straight after a send the composer re-renders; typing into it with no
  // delay interleaves the keystrokes ("nothise: t").
  await composer.pressSequentially("note: this", { delay: 20 });
  await expect(composer, "the draft is what was typed").toHaveValue(
    "note: this",
  );
  await expect(
    options,
    "a colon followed by a space is not a query",
  ).toHaveCount(0);
  await A.keyboard.press("Enter");
  await expect(lastMessage).toHaveText("note: this");

  // Editing converts as well.
  const last = A.locator(".message").last();
  await last.hover();
  await last.locator('.message-action[aria-label="Edit"]').click();
  await A.locator(".message-editor textarea").pressSequentially(" :+1:");
  await A.keyboard.press("Enter");
  await expect(lastMessage, "the inline editor converts on save").toHaveText(
    /^note: this 👍/,
  );
});
