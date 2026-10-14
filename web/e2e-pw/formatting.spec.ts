import type { Page } from "@playwright/test";
import { expect, paste, seed, signIn, test } from "./lib";

// Formatting in the message box and the timeline: typed marker pairs turn
// into styled text in the editor, the toolbar and its shortcuts style the
// selection, pasted Markdown keeps its formatting, the timeline renders
// real elements, previews stay plain, and editing shows the formatting.
// Typing is the subject — the input rules and the mention picker follow
// keystrokes — so the draft is typed unless a step is about pasting. What
// each command does to the document is RichEditor/editor.test.ts; here one
// button and one shortcut prove the wiring.
test("formatting in the composer and the timeline", async ({ browser }) => {
  const { suffix, tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  const composer = (p: Page) => p.locator(".composer .rich-editor-content");
  const selectAll = async (p: Page) => {
    await composer(p).focus();
    await p.keyboard.press("ControlOrMeta+a");
  };
  const send = async (p: Page, text: string) => {
    await composer(p).pressSequentially(text);
    await p.keyboard.press("Enter");
  };
  const last = (p: Page) => p.locator(".message-content").last();
  const clickTool = (p: Page, label: string) =>
    p.locator(`.composer .format-button[aria-label="${label}"]`).click();
  const clickAction = async (p: Page, index: number, label: string) => {
    const row = p.locator(".message").nth(index);
    await row.hover();
    await row.locator(`.message-action[aria-label="${label}"]`).click();
  };

  await signIn(A, tokens.ada);
  await expect(composer(A)).toBeVisible();
  await signIn(B, tokens.bea);
  await expect(composer(B)).toBeVisible();

  // Typed marker pairs style their words in the editor, markers gone.
  // (The trailing space closes the mention picker so Enter sends.)
  await composer(A).pressSequentially(
    `**bold** *it* __under__ ~~gone~~ \`code\` https://example.com/x. @bea${suffix} `,
  );
  for (const [sel, text] of [
    ["strong", "bold"],
    ["em", "it"],
    ["u", "under"],
    ["s", "gone"],
    ["code", "code"],
    [".rich-autolink", "https://example.com/x"],
  ] as const) {
    await expect(
      composer(A).locator(sel),
      `the editor styles <${sel}> ${text}`,
    ).toHaveText(text);
  }
  await expect(composer(A), "no markers in the editor").not.toContainText("*");
  await A.keyboard.press("Enter");

  // The timeline renders the same, and B sees it live.
  for (const [sel, text] of [
    ["strong", "bold"],
    ["em", "it"],
    ["u", "under"],
    ["s", "gone"],
    ["code.md-code", "code"],
    ["a.md-link", "https://example.com/x"],
    [".mention", `@bea${suffix}`],
  ] as const) {
    await expect(last(A).locator(sel), `renders <${sel}> ${text}`).toHaveText(
      text,
    );
  }
  await expect(
    last(A).locator("a.md-link"),
    "links open in a new tab",
  ).toHaveAttribute("target", "_blank");
  await expect(last(B).locator("strong"), "B sees the bold live").toHaveText(
    "bold",
  );
  await expect(
    last(B),
    "no raw markers in the rendered text",
  ).not.toContainText("**");

  // A literal marker typed on its own stays a character.
  await send(A, "2 * 3 = 6");
  await expect(last(A), "a lone star is text").toHaveText("2 * 3 = 6");

  // Toolbar: styles the selection and keeps focus and the selection.
  await composer(A).pressSequentially("hi there");
  await selectAll(A);
  await clickTool(A, "Bold");
  await expect(
    composer(A).locator("strong"),
    "toolbar bold styles the selection",
  ).toHaveText("hi there");
  await expect(
    A.locator('.composer .format-button[aria-label="Bold"]'),
    "…and shows pressed over it",
  ).toHaveAttribute("aria-pressed", "true");
  await expect(composer(A), "the editor keeps focus").toBeFocused();
  await expect
    .poll(() => A.evaluate(() => window.getSelection()?.toString()), {
      message: "the words stay selected",
    })
    .toBe("hi there");
  // A shortcut reaches the same command from the keyboard.
  await A.keyboard.press("Control+Shift+X");
  await expect(composer(A).locator("s"), "Ctrl+Shift+X strikes").toHaveText(
    "hi there",
  );
  await A.keyboard.press("Enter");
  await expect(
    last(A).locator(":is(s strong, strong s)"),
    "nested strike and bold render",
  ).toHaveText("hi there");

  // A button shows pressed while its style is in effect at the caret.
  const tool = (p: Page, label: string) =>
    p.locator(`.composer .format-button[aria-label="${label}"]`);
  // With nothing selected, Bold stays on and what's typed is bold until
  // it is switched off again.
  await composer(A).pressSequentially("one ");
  await clickTool(A, "Bold");
  await expect(tool(A, "Bold"), "Bold stays pressed").toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await composer(A).pressSequentially("two");
  await expect(
    composer(A).locator("strong"),
    "typing after Bold is bold",
  ).toHaveText("two");
  await expect(tool(A, "Bold"), "…and Bold is still pressed").toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickTool(A, "Bold");
  await composer(A).pressSequentially(" three");
  await expect(
    composer(A).locator("strong"),
    "switching Bold off stops the bold",
  ).toHaveText("two");
  await expect(tool(A, "Bold")).toHaveAttribute("aria-pressed", "false");
  // Clicking into bold words presses the button; out of them releases it.
  await composer(A).locator("strong").click();
  await expect(
    tool(A, "Bold"),
    "the caret in bold words presses Bold",
  ).toHaveAttribute("aria-pressed", "true");
  await A.keyboard.press("End");
  await expect(
    tool(A, "Bold"),
    "…and leaving them releases it",
  ).toHaveAttribute("aria-pressed", "false");
  await A.keyboard.press("Enter");
  await expect(last(A).locator("strong")).toHaveText("two");

  // Links: the button opens a form for the words and the address.
  const linkForm = A.locator(".link-dialog");
  const field = (label: string) =>
    linkForm.locator(".field").filter({ hasText: label }).locator("input");
  await composer(A).pressSequentially("docs");
  await selectAll(A);
  await clickTool(A, "Link");
  await expect(field("Text"), "the form holds the selected words").toHaveValue(
    "docs",
  );
  await expect(field("Address"), "…and waits for the address").toBeFocused();
  await A.keyboard.type("example.org");
  await A.keyboard.press("Enter");
  await expect(
    linkForm.locator(".field-error"),
    "an address without http:// is refused beside its field",
  ).toBeVisible();
  await field("Address").fill("https://example.org/a");
  await A.keyboard.press("Enter");
  await expect(linkForm, "Enter saves").toHaveCount(0);
  await expect(composer(A).locator("a"), "the words are linked").toHaveText(
    "docs",
  );
  await expect(composer(A), "the editor has focus back").toBeFocused();
  // A double click on the link opens it for editing.
  await composer(A).locator("a").dblclick();
  await expect(field("Address"), "the form holds the address").toHaveValue(
    "https://example.org/a",
  );
  await field("Address").fill("https://example.org/b");
  await A.keyboard.press("Enter");
  await expect(composer(A).locator("a")).toHaveAttribute(
    "href",
    "https://example.org/b",
  );
  // The caret in the link presses the button, and the button unlinks.
  await composer(A).locator("a").click();
  await expect(
    tool(A, "Link"),
    "the caret in a link presses Link",
  ).toHaveAttribute("aria-pressed", "true");
  await clickTool(A, "Link");
  await expect(composer(A).locator("a"), "Link removes the link").toHaveCount(
    0,
  );
  await expect(composer(A)).toHaveText("docs");
  // Ctrl/⌘+K with nothing selected adds a link at the caret.
  await A.keyboard.press("End");
  await A.keyboard.type(" and ");
  await A.keyboard.press("ControlOrMeta+k");
  await expect(field("Text"), "with no words, Text is first").toBeFocused();
  await A.keyboard.type("more");
  await field("Address").fill("https://example.org/c");
  await A.keyboard.press("Enter");
  await A.keyboard.press("Enter");
  await expect(last(A).locator("a.md-link"), "the link is sent").toHaveText(
    "more",
  );
  await expect(last(A)).toHaveText("docs and more");

  // Inline code switched on keeps going for everything typed after it.
  await clickTool(A, "Inline code");
  await composer(A).pressSequentially("x = 1");
  await expect(
    composer(A).locator("code"),
    "everything typed after Inline code is code",
  ).toHaveText("x = 1");
  await A.keyboard.press("Enter");
  await expect(last(A).locator("code.md-code")).toHaveText("x = 1");

  // Three backticks at the start of a line open a code block.
  await composer(A).pressSequentially("```");
  await composer(A).pressSequentially("let y");
  await expect(
    composer(A).locator("pre"),
    "typing ``` opens a code block",
  ).toHaveText("let y");
  await A.keyboard.press("Enter");
  await expect(last(A).locator("pre.md-pre code")).toHaveText("let y");

  // Quote via the toolbar, then out of it and a code block after.
  await composer(A).pressSequentially("wise words");
  await clickTool(A, "Quote");
  await expect(
    composer(A).locator("blockquote"),
    "quote wraps the line",
  ).toHaveText("wise words");
  await A.keyboard.press("End");
  await A.keyboard.press("Shift+Enter");
  await A.keyboard.press("Shift+Enter");
  await composer(A).pressSequentially("x := 1");
  await clickTool(A, "Code block");
  await expect(
    composer(A).locator("pre"),
    "code block holds the line after the quote",
  ).toHaveText("x := 1");
  await A.keyboard.press("Enter");
  await expect(
    last(A).locator("blockquote.md-quote"),
    "quote renders",
  ).toHaveText("wise words");
  await expect(
    last(A).locator("pre.md-pre code"),
    "code block renders",
  ).toHaveText("x := 1");

  // Lists: the toolbar starts one and a new line is the next item.
  await composer(A).pressSequentially("milk");
  await clickTool(A, "Bulleted list");
  await A.keyboard.press("End");
  await A.keyboard.press("Shift+Enter");
  await composer(A).pressSequentially("eggs");
  await expect(
    composer(A).locator("ul li"),
    "the editor shows a list",
  ).toHaveText(["milk", "eggs"]);
  await A.keyboard.press("Enter");
  await expect(
    last(A).locator("ul.md-list li"),
    "a bulleted list renders as a real ul",
  ).toHaveText(["milk", "eggs"]);

  // Pasted Markdown keeps its formatting. Numbered, with bulleted
  // children: each level picks its own tag, and the sub-list lives inside
  // the <li> it belongs to (never <li> beside <li>).
  await paste(composer(A), "1. first\n  - under\n2. second");
  await A.keyboard.press("Enter");
  const ordered = last(A).locator("ol.md-list");
  await expect(ordered).toBeVisible();
  const shape = await ordered.evaluate((ol) => ({
    top: [...ol.children].map((li) => li.firstChild?.textContent),
    nestedTag: ol.querySelector("li > ul, li > ol")?.tagName ?? null,
    nestedText: ol.querySelector("li ul li")?.textContent,
    liInsideLi: !!ol.querySelector("li > li"),
  }));
  expect(shape.top, "the numbered list's own items").toEqual([
    "first",
    "second",
  ]);
  expect(shape.nestedTag, "its child list is a ul").toBe("UL");
  expect(shape.nestedText, "…holding the indented item").toBe("under");
  expect(shape.liInsideLi, "and no <li> sits beside an <li>").toBe(false);

  // A run that switches marker kind is two lists, not one.
  await paste(composer(A), "- a bullet\n1. a number");
  await A.keyboard.press("Enter");
  await expect
    .poll(
      () =>
        last(A).evaluate((e) =>
          [...e.children].map((c) => c.tagName).join(","),
        ),
      { message: "switching marker kind starts a new list" },
    )
    .toBe("UL,OL");

  // Spoilers: the toolbar marks one, the timeline hides it until clicked.
  await composer(A).pressSequentially("a thing");
  await selectAll(A);
  await clickTool(A, "Spoiler");
  await expect(
    composer(A).locator(".rich-spoiler"),
    "the spoiler button marks the selection",
  ).toHaveText("a thing");
  await A.keyboard.press("Enter");
  const spoiler = A.locator(".message-content .md-spoiler");
  await expect(
    A.locator("button.md-spoiler"),
    "a spoiler renders as a button",
  ).toHaveCount(1);
  await expect(spoiler, "…and starts unrevealed").toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect
    .poll(() => spoiler.evaluate((e) => getComputedStyle(e).color), {
      message: "the spoiler's text is not readable before it is clicked",
    })
    .toBe("rgba(0, 0, 0, 0)");
  await expect(
    spoiler,
    "…though the words are in the DOM for a screen reader once revealed",
  ).toHaveText("a thing");
  await spoiler.click();
  await expect(spoiler, "clicking reveals it").toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect
    .poll(() => spoiler.evaluate((e) => getComputedStyle(e).color), {
      message: "…and its text becomes readable",
    })
    .not.toBe("rgba(0, 0, 0, 0)");

  // Previews are plain: the reply bar, the reply quote, and B's activity row.
  await clickAction(A, 0, "Reply");
  const bar = A.locator(".reply-bar");
  await expect(bar, "reply bar preview carries the words").toContainText(
    "bold it under gone code",
  );
  await expect(bar, "reply bar preview is plain text").not.toContainText("**");
  await send(A, "re: that");
  const quote = A.locator(".reply-quote .reply-preview");
  await expect(quote, "reply quote preview carries the words").toContainText(
    "bold it under gone",
  );
  await expect(quote, "reply quote preview is plain text").not.toContainText(
    "**",
  );
  await B.locator('a[href="/activity"]').click();
  const preview = B.locator(".activity-preview");
  await expect(preview, "activity preview carries the words").toContainText(
    "bold it under gone",
  );
  await expect(preview, "activity preview is plain text").not.toContainText(
    "**",
  );

  // Editing shows the formatting, not the markers, and keeps it.
  await clickAction(A, 0, "Edit");
  const editor = A.locator(".message-editor .rich-editor-content");
  await expect(editor, "the edit box has focus").toBeFocused();
  await expect(
    editor.locator("strong").first(),
    "the edit box shows the bold",
  ).toHaveText("bold");
  await expect(editor, "…without its markers").not.toContainText("**");
  await A.keyboard.type(" edited");
  await A.keyboard.press("Enter");
  const edited = A.locator(".message-content").first();
  await expect(
    edited.locator("strong"),
    "edited message still renders formatting",
  ).toHaveText("bold");
  await expect(edited, "…and carries the new words").toContainText("edited");
});
