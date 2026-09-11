import type { Page } from "@playwright/test";
import { expect, seed, signIn, test } from "./lib";

// STOOP-38: live Markdown styling in the message box. The composer and the
// inline editor layer a styled overlay under the textarea: markers stay
// visible (dimmed .md-marker spans), content between them is styled, and
// the overlay's text content equals the draft exactly.
// Ported from web/e2e/composer-styling.mjs (STOOP-238). The draft is typed
// a key at a time throughout — the overlay, the auto-grow and the
// scroll-to-caret all follow keystrokes, which one fill() would skip.
test("live Markdown styling under the composer", async ({ browser }) => {
  const { suffix, tokens } = await seed({ channels: ["general"] });

  const textarea = (p: Page, root = ".composer") =>
    p.locator(`${root} textarea`);
  const overlay = (p: Page, root = ".composer") =>
    p.locator(`${root} .composer-overlay`);

  // The overlay's text and the draft, read together so nothing can change
  // between the two reads.
  const info = (p: Page, root = ".composer") =>
    textarea(p, root).evaluate((ta: HTMLTextAreaElement) => {
      const ov = ta.parentElement?.querySelector(".composer-overlay") ?? null;
      return {
        text: ov ? (ov.textContent ?? "") : null,
        value: ta.value,
        height: ta.getBoundingClientRect().height,
      };
    });
  // Character-for-character, so this compares textContent itself rather
  // than toHaveText's whitespace-normalised form.
  const inSync = (p: Page, message: string, root = ".composer") =>
    expect
      .poll(
        async () => {
          const i = await info(p, root);
          return i.text === i.value
            ? "in sync"
            : `overlay ${JSON.stringify(i.text)} vs draft ${JSON.stringify(i.value)}`;
        },
        { message },
      )
      .toBe("in sync");
  const markers = (p: Page, root = ".composer") =>
    overlay(p, root).locator(".md-marker");
  const style = (p: Page, sel: string, prop: string, root = ".composer") =>
    p
      .locator(`${root} .composer-overlay`)
      .locator(sel)
      .evaluate((e, name) => getComputedStyle(e).getPropertyValue(name), prop);

  const A = await (await browser.newContext()).newPage();
  await signIn(A, tokens.ada);
  await expect(textarea(A)).toBeVisible();
  const B = await (await browser.newContext()).newPage();
  await signIn(B, tokens.bea);
  await expect(textarea(B)).toBeVisible();

  const composer = textarea(A);

  // Empty draft: no overlay content, and the placeholder still shows.
  await expect(
    overlay(A),
    "empty draft: overlay present, aria-hidden, empty",
  ).toHaveCount(1);
  await expect(overlay(A), "empty draft: the overlay is empty").toHaveText("");
  await expect(
    overlay(A),
    "empty draft: the overlay is aria-hidden",
  ).toHaveAttribute("aria-hidden", "true");
  await expect(
    composer,
    "placeholder still shows when the draft is empty",
  ).toHaveAttribute("placeholder", "Message #general");
  await expect
    .poll(() => overlay(A).evaluate((e) => getComputedStyle(e).pointerEvents), {
      message: "overlay is pointer-events: none (the textarea keeps all input)",
    })
    .toBe("none");
  await expect
    .poll(() => composer.evaluate((e) => getComputedStyle(e).caretColor), {
      message: "caret is visible",
    })
    .not.toBe("rgba(0, 0, 0, 0)");

  // Typing **foo** styles the content, keeps both markers dimmed.
  await composer.pressSequentially("**foo**");
  await expect(
    overlay(A).locator("strong"),
    "overlay <strong> contains the **foo** text",
  ).toHaveText("**foo**");
  await expect
    .poll(() => markers(A).allTextContents(), {
      message: "markers stay in .md-marker spans around the styled content",
    })
    .toContain("**");
  await expect(markers(A), "both ** markers are present").toHaveCount(2);
  await expect(
    overlay(A),
    "overlay text equals the draft (**foo**)",
  ).toHaveText("**foo**");
  await inSync(A, "overlay text equals the draft exactly (**foo**)");

  // Lists and spoilers (STOOP-37) keep the same contract: the bullet and the
  // || pair are dimmed markers, the content between them is styled, and a
  // spoiler is readable while you write it — you are not hiding it from
  // yourself.
  await composer.fill("");
  await composer.pressSequentially("- ||hush||");
  await expect(overlay(A), "overlay reproduces the draft").toHaveText(
    "- ||hush||",
  );
  await expect
    .poll(() => markers(A).allTextContents(), {
      message: "the bullet is a dimmed marker",
    })
    .toContain("- ");
  await expect(
    overlay(A).locator(".ov-list .md-marker").first(),
    "the bullet marker sits inside the list span",
  ).toBeAttached();
  await expect(
    overlay(A).locator(".ov-spoiler"),
    "the spoiler keeps its markers in the overlay",
  ).toHaveText("||hush||");
  await expect
    .poll(() => style(A, ".ov-spoiler", "visibility"), {
      message: "a spoiler is not hidden from its own author",
    })
    .toBe("visible");
  await composer.fill("");
  await composer.pressSequentially("**foo**");
  await expect(composer).toHaveValue("**foo**");

  // The textarea still grows in height with the text (useAutoGrow). Checked
  // here, before the multi-line edits below cap it at max-height: 40vh.
  const h1 = (await info(A)).height;
  await composer.focus();
  await A.keyboard.press("Shift+Enter");
  await composer.pressSequentially("second line");
  await expect
    .poll(async () => (await info(A)).height, {
      message: `textarea grows with the text (from ${h1}px)`,
    })
    .toBeGreaterThan(h1);

  // Several edits, including Shift+Enter newlines: the overlay always
  // reproduces the draft character for character.
  const edits = [
    "**foo** *bar* __baz__ ~~gone~~ `code`",
    "plain line",
    "> quote",
    "- item",
    "  - nested",
    "1. numbered",
    "||spoiler||",
    "```",
    "x := 1",
    "```",
    "https://example.com/a",
  ];
  for (const piece of edits) {
    await composer.focus();
    await A.keyboard.press("Shift+Enter");
    await composer.pressSequentially(piece);
    await inSync(A, `overlay text equals the draft after appending "${piece}"`);
  }
  await inSync(A, "fences and newline edits stay in sync");
  await expect(composer, "…with the fences in the draft").toHaveValue(/```/);

  for (const [sel, text, what] of [
    ["strong", "**foo**", "bold"],
    ["em", "*bar*", "italic"],
    ["u", "__baz__", "underline"],
    ["s", "~~gone~~", "strike"],
    ["code", "`code`", "inline code"],
    [".ov-quote", "> quote", "quote line"],
  ] as const) {
    await expect(
      overlay(A).locator(sel).first(),
      `${what} styled in the overlay`,
    ).toHaveText(text);
  }
  // The fence keeps its newlines, so compare the raw text content.
  await expect
    .poll(
      () =>
        overlay(A)
          .locator(".ov-codeblock")
          .first()
          .evaluate((e) => e.textContent),
      { message: "code fence styled in the overlay" },
    )
    .toBe("```\nx := 1\n```");

  // Styling must not change advance widths, or the styled text drifts away
  // from the transparent textarea's caret: compare each styled element's
  // rendered width with the same characters at the textarea's own font.
  const drift = await composer.evaluate((ta: HTMLTextAreaElement) => {
    const ov = ta.parentElement?.querySelector(".composer-overlay");
    const cs = getComputedStyle(ta);
    const plainWidth = (text: string) => {
      const s = document.createElement("span");
      s.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`;
      s.textContent = text;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return ["strong", "em", "u", "s", "code"].map((sel) => {
      const el = ov?.querySelector(sel) as HTMLElement;
      return [
        sel,
        Math.abs(
          el.getBoundingClientRect().width - plainWidth(el.textContent ?? ""),
        ),
      ] as [string, number];
    });
  });
  for (const [sel, d] of drift)
    expect(
      d,
      `overlay <${sel}> keeps the textarea's glyph widths (drift ${d.toFixed(2)}px)`,
    ).toBeLessThan(1);

  // The overlay follows the textarea's own scrolling — wheel/drag and the
  // browser's scroll-to-caret — not just re-renders.
  const tops = () =>
    composer.evaluate((ta: HTMLTextAreaElement) => {
      const ov = ta.parentElement?.querySelector(".composer-overlay");
      return {
        ta: ta.scrollTop,
        ov: ov ? ov.scrollTop : null,
        overflow: ta.scrollHeight > ta.clientHeight,
      };
    });
  await composer.fill("");
  await composer.focus();
  for (let i = 1; i <= 30; i++) {
    await composer.pressSequentially(`line ${i}`);
    if (i < 30) await A.keyboard.press("Shift+Enter");
  }
  await expect
    .poll(
      async () => {
        const t = await tops();
        return {
          overflow: t.overflow,
          scrolled: t.ta > 0,
          synced: t.ta === t.ov,
        };
      },
      { message: "overlay scrolled with the caret" },
    )
    .toEqual({ overflow: true, scrolled: true, synced: true });

  await composer.evaluate((e: HTMLTextAreaElement) => {
    e.scrollTop = 0;
  });
  await expect
    .poll(
      async () => {
        const t = await tops();
        return { ta: t.ta, ov: t.ov };
      },
      { message: "overlay follows a scroll with no typing" },
    )
    .toEqual({ ta: 0, ov: 0 });

  await A.keyboard.type("x");
  await expect
    .poll(
      async () => {
        const t = await tops();
        return { scrolled: t.ta > 0, synced: t.ta === t.ov };
      },
      { message: "overlay follows the scroll-to-caret after a keystroke" },
    )
    .toEqual({ scrolled: true, synced: true });

  // The @mention picker still opens on @ and inserts the handle.
  await composer.fill("");
  await composer.pressSequentially("@bea");
  await expect(
    A.locator(".mention-picker"),
    "mention picker opens on @",
  ).toHaveCount(1);
  await expect(
    A.locator(".mention-picker .mention-option").first(),
  ).toBeVisible();
  await A.keyboard.press("Enter");
  await expect(composer, "mention inserts the handle").toHaveValue(
    `@bea${suffix} `,
  );
  await A.keyboard.press("Backspace"); // drop the trailing space

  // The toolbar Bold button still wraps the selection.
  await composer.fill("");
  await composer.pressSequentially("hi there");
  await composer.evaluate((e: HTMLTextAreaElement) => {
    e.focus();
    e.select();
  });
  await A.locator('.composer .format-button[aria-label="Bold"]').click();
  await expect(composer, "toolbar bold wraps the selection").toHaveValue(
    "**hi there**",
  );
  await expect
    .poll(
      () => composer.evaluate((e: HTMLTextAreaElement) => e.selectionStart),
      { message: "the selection survives the toolbar edit" },
    )
    .toBe(2);
  await expect(composer, "focus survives the toolbar edit").toBeFocused();

  // Enter sends, and the message renders normally (no overlay elements in
  // the rendered message, no raw markers in the rendered text).
  await A.keyboard.press("Enter");
  const last = A.locator(".message-content").last();
  await expect(
    last.locator("strong"),
    "sent message renders <strong> as before",
  ).toHaveText("hi there");
  await expect(last, "rendered message has no raw markers").not.toContainText(
    "**",
  );
  await expect(
    last.locator(".composer-overlay"),
    "rendered message has no overlay",
  ).toHaveCount(0);
  await expect(composer, "composer cleared after send").toHaveValue("");
  await expect(
    B.locator(".message-content").first().locator("strong"),
    "B sees the styled message live",
  ).toHaveText("hi there");

  // The inline editor shows the same styling.
  const row = A.locator(".message").first();
  await row.hover();
  await row.locator('.message-action[aria-label="Edit"]').click();
  await expect(textarea(A, ".message-editor")).toBeVisible();
  await inSync(
    A,
    "inline editor overlay text equals its value",
    ".message-editor",
  );
  await expect(
    overlay(A, ".message-editor").locator("strong"),
    "inline editor shows the styled markers",
  ).toHaveText("**hi there**");
  await expect(
    markers(A, ".message-editor"),
    "inline editor keeps both markers",
  ).toHaveCount(2);
  await A.keyboard.press("Escape");
});
