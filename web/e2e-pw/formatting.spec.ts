import type { Page } from "@playwright/test";
import { expect, seed, signIn, test } from "./lib";

// Markdown in the composer and the timeline: inline syntax renders as
// real elements, the toolbar and its shortcuts wrap the selection, lists
// and spoilers work, previews stay plain, and editing keeps the markup.
// Ported from web/e2e/formatting.mjs (STOOP-238). Typing is the subject
// throughout — the caret, the selection and the mention picker all
// depend on keystrokes — so this spec types instead of filling.
test("markdown in the composer and the timeline", async ({ browser }) => {
  const { suffix, tokens } = await seed({ channels: ["general"] });
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();

  const composer = (p: Page) => p.locator(".composer textarea");
  const selectAll = (p: Page) =>
    composer(p).evaluate((e: HTMLTextAreaElement) => {
      e.focus();
      e.select();
    });
  const send = async (p: Page, text: string) => {
    await composer(p).pressSequentially(text);
    await p.keyboard.press("Enter");
  };
  const sendLines = async (p: Page, lines: string[]) => {
    await composer(p).focus();
    for (const [i, line] of lines.entries()) {
      if (i > 0) await p.keyboard.press("Shift+Enter");
      await composer(p).pressSequentially(line);
    }
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

  // Inline syntax renders as real elements, and B sees the same live.
  // (The trailing space closes the mention picker so Enter sends.)
  await send(
    A,
    `**bold** *it* __under__ ~~gone~~ \`code\` https://example.com/x. @bea${suffix} `,
  );
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

  // Toolbar: wraps the selection, toggles off again, and keeps focus.
  await composer(A).pressSequentially("hi there");
  await selectAll(A);
  await clickTool(A, "Bold");
  await expect(composer(A), "toolbar bold wraps the selection").toHaveValue(
    "**hi there**",
  );
  await expect(composer(A), "the textarea keeps focus").toBeFocused();
  await expect
    .poll(
      () => composer(A).evaluate((e: HTMLTextAreaElement) => e.selectionStart),
      { message: "the inner text is left selected" },
    )
    .toBe(2);
  await clickTool(A, "Bold");
  await expect(composer(A), "bold again unwraps").toHaveValue("hi there");
  // Shortcuts.
  await selectAll(A);
  await A.keyboard.press("Control+i");
  await expect(composer(A), "Ctrl+I italicises").toHaveValue("*hi there*");
  await selectAll(A);
  await A.keyboard.press("Control+Shift+X");
  await expect(composer(A), "Ctrl+Shift+X strikes").toHaveValue(
    "~~*hi there*~~",
  );
  await A.keyboard.press("Enter");
  await expect(
    last(A).locator("s em"),
    "nested strike/italic renders",
  ).toHaveText("hi there");
  // With no selection the markers open around the caret, so what you type
  // next is inside them; the same shortcut again with the empty pair removes it.
  await composer(A).pressSequentially("say ");
  await A.keyboard.press("Control+b");
  await composer(A).pressSequentially("loud");
  await expect(
    composer(A),
    "caret-only bold wraps what you type next",
  ).toHaveValue("say **loud**");
  await A.keyboard.press("Control+b");
  await composer(A).pressSequentially("er");
  await expect(
    composer(A),
    "the shortcut at the closer moves past it",
  ).toHaveValue("say **loud**er");
  await composer(A).fill("");
  await expect(composer(A), "composer cleared for the next step").toHaveValue(
    "",
  );

  // Quote and code block via the toolbar, multi-line.
  await composer(A).pressSequentially("wise words");
  await clickTool(A, "Quote");
  await expect(composer(A), "quote prefixes the line").toHaveValue(
    "> wise words",
  );
  await A.keyboard.press("End");
  await A.keyboard.press("Shift+Enter");
  await composer(A).pressSequentially("x := 1");
  await composer(A).evaluate((e: HTMLTextAreaElement) => {
    e.setSelectionRange(e.value.length - 6, e.value.length);
  });
  await clickTool(A, "Code block");
  await expect(
    composer(A),
    "code block fences the selection on its own lines",
  ).toHaveValue("> wise words\n```\nx := 1\n```");
  await A.keyboard.press("Enter");
  await expect(
    last(A).locator("blockquote.md-quote"),
    "quote renders",
  ).toHaveText("wise words");
  await expect(
    last(A).locator("pre.md-pre code"),
    "code block renders",
  ).toHaveText("x := 1");

  // Lists and spoilers (STOOP-37): toolbar writes them, the timeline renders
  // real <ul>/<ol> and a spoiler that stays hidden until it is clicked.
  await composer(A).pressSequentially("milk");
  await clickTool(A, "Bulleted list");
  await expect(composer(A), "the list button prefixes the line").toHaveValue(
    "- milk",
  );
  await A.keyboard.press("End");
  await A.keyboard.press("Shift+Enter");
  await composer(A).pressSequentially("- eggs");
  await A.keyboard.press("Enter");
  await expect(
    last(A).locator("ul.md-list li"),
    "a bulleted list renders as a real ul",
  ).toHaveText(["milk", "eggs"]);

  // Numbered, with bulleted children: each level picks its own tag, and the
  // sub-list lives inside the <li> it belongs to (never <li> beside <li>).
  await sendLines(A, ["1. first", "  - under", "2. second"]);
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
  await sendLines(A, ["- a bullet", "1. a number"]);
  await expect
    .poll(
      () =>
        last(A).evaluate((e) =>
          [...e.children].map((c) => c.tagName).join(","),
        ),
      { message: "switching marker kind starts a new list" },
    )
    .toBe("UL,OL");
  // Switching list style swaps the prefix rather than stacking it.
  await composer(A).pressSequentially("- a thing");
  await clickTool(A, "Numbered list");
  await expect(composer(A), "list buttons swap prefixes").toHaveValue(
    "1. a thing",
  );
  await clickTool(A, "Numbered list");
  await expect(
    composer(A),
    "clicking the same one again removes it",
  ).toHaveValue("a thing");
  await selectAll(A);
  await clickTool(A, "Spoiler");
  await expect(
    composer(A),
    "the spoiler button wraps the selection",
  ).toHaveValue("||a thing||");
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

  // Editing shows the raw Markdown and keeps it.
  await clickAction(A, 0, "Edit");
  const editor = A.locator(".message-editor textarea");
  await expect(editor, "editor shows the raw markup").toHaveValue(
    /^\*\*bold\*\*/,
  );
  await editor.evaluate((e: HTMLTextAreaElement) => {
    e.focus();
    e.setSelectionRange(e.value.length, e.value.length);
  });
  await editor.pressSequentially(" edited");
  await A.keyboard.press("Enter");
  const edited = A.locator(".message-content").first();
  await expect(
    edited.locator("strong"),
    "edited message still renders formatting",
  ).toHaveText("bold");
  await expect(edited, "…and carries the new words").toContainText("edited");
});
