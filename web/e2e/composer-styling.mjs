import puppeteer from "puppeteer-core";
import { BASE as base, chromePath, sleep } from "./lib.mjs";

// STOOP-38: live Markdown styling in the message box. The composer and the
// inline editor layer a styled overlay under the textarea: markers stay
// visible (dimmed .md-marker spans), content between them is styled, and
// the overlay's text content equals the draft exactly.
let fails = 0;
const check = (ok, msg) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
});
const newPage = async (tag) => {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => {
    console.log(`[${tag} pageerror]`, e.message);
    fails++;
  });
  p.on("dialog", (d) => d.accept());
  return p;
};
const suffix = String(Date.now() % 1000000);
const path = (p) => new URL(p.url()).pathname;
const draft = (p) => p.$eval(".composer textarea", (e) => e.value);

const overlayInfo = (p, sel = ".composer textarea") =>
  p.evaluate((sel) => {
    const ta = document.querySelector(sel);
    const ov = ta.parentElement.querySelector(".composer-overlay");
    return {
      taHeight: ta.getBoundingClientRect().height,
      taScrollHeight: ta.scrollHeight,
      overlay: ov
        ? {
            text: ov.textContent,
            ariaHidden: ov.getAttribute("aria-hidden"),
            pointerEvents: getComputedStyle(ov).pointerEvents,
          }
        : null,
      caretColor: getComputedStyle(ta).caretColor,
    };
  }, sel);

const A = await newPage("A");
await A.goto(`${base}/`, { waitUntil: "networkidle0" });
await sleep(300);
if (path(A) !== "/setup") throw new Error("need a fresh instance");
await A.type('input[autocomplete="username"]', `ada${suffix}`);
await A.type('input[type="password"]', "correct horse battery");
await A.click('button[type="submit"]');
await sleep(1500);
await A.type('input[placeholder="The Porch"]', "Stoop HQ");
await A.click('button[type="submit"]');
await sleep(1500);
// Setup step 3 (reaching your server) is skippable.
await A.click("button.reach-continue");
await sleep(800);
await A.waitForSelector(".link-box code", { timeout: 3000 });
const link = await A.$eval(".link-box code", (e) => e.textContent);
await A.click("button.primary");
await sleep(1000);
const B = await newPage("B");
await B.goto(link, { waitUntil: "networkidle0" });
await sleep(300);
await B.type('input[autocomplete="username"]', `bea${suffix}`);
await B.type('input[type="password"]', "correct horse battery");
await B.click('button[type="submit"]');
await B.waitForSelector(".composer textarea", { timeout: 8000 });
await sleep(800);

// Empty draft: no overlay content, and the placeholder still shows.
{
  const info = await overlayInfo(A);
  check(
    info.overlay &&
      info.overlay.text === "" &&
      info.overlay.ariaHidden === "true",
    "empty draft: overlay present, aria-hidden, empty",
  );
  check(
    (await A.$eval(
      ".composer textarea",
      (e) => e.placeholder === "Message #general",
    )) === true,
    "placeholder still shows when the draft is empty",
  );
  check(
    info.overlay && info.overlay.pointerEvents === "none",
    "overlay is pointer-events: none (the textarea keeps all input)",
  );
  check(info.caretColor !== "rgba(0, 0, 0, 0)", "caret is visible");
}

// Typing **foo** styles the content, keeps both markers dimmed.
await A.type(".composer textarea", "**foo**");
{
  const ov = await A.$eval(".composer textarea", (e) => {
    const o = e.parentElement.querySelector(".composer-overlay");
    const strong = o.querySelector("strong");
    const markers = [...o.querySelectorAll(".md-marker")].map(
      (m) => m.textContent,
    );
    return {
      strong: strong ? strong.textContent : null,
      markers,
      markerCount: o.querySelectorAll(".md-marker").length,
    };
  });
  check(ov.strong === "**foo**", "overlay <strong> contains the **foo** text");
  check(
    ov.strong && ov.strong.includes("foo") && ov.markers.includes("**"),
    "markers stay in .md-marker spans around the styled content",
  );
  check(ov.markerCount === 2, "both ** markers are present");
  const info = await overlayInfo(A);
  check(
    info.overlay &&
      info.overlay.text === "**foo**" &&
      info.overlay.text === (await draft(A)),
    "overlay text equals the draft exactly (**foo**)",
  );
}

// Lists and spoilers (STOOP-37) keep the same contract: the bullet and the
// || pair are dimmed markers, the content between them is styled, and a
// spoiler is readable while you write it — you are not hiding it from
// yourself.
{
  await A.$eval(".composer textarea", (e) => {
    e.value = "";
    e.focus();
  });
  await A.type(".composer textarea", "- ||hush||");
  await sleep(150);
  const ov = await A.$eval(".composer textarea", (e) => {
    const o = e.parentElement.querySelector(".composer-overlay");
    const spoiler = o.querySelector(".ov-spoiler");
    return {
      text: o.textContent,
      markers: [...o.querySelectorAll(".md-marker")].map((m) => m.textContent),
      spoiler: spoiler ? spoiler.textContent : null,
      hidden: spoiler ? getComputedStyle(spoiler).visibility : null,
      listMarker: !!o.querySelector(".ov-list .md-marker"),
    };
  });
  check(
    ov.text === "- ||hush||",
    `overlay reproduces the draft (${JSON.stringify(ov.text)})`,
  );
  check(
    ov.markers.includes("- "),
    `the bullet is a dimmed marker (${JSON.stringify(ov.markers)})`,
  );
  check(ov.listMarker, "the bullet marker sits inside the list span");
  check(
    ov.spoiler === "||hush||",
    "the spoiler keeps its markers in the overlay",
  );
  check(ov.hidden === "visible", "a spoiler is not hidden from its own author");
  await A.$eval(".composer textarea", (e) => {
    e.value = "";
    e.focus();
  });
  await A.type(".composer textarea", "**foo**");
  await sleep(100);
}

// The textarea still grows in height with the text (useAutoGrow). Checked
// here, before the multi-line edits below cap it at max-height: 40vh.
{
  const h1 = (await overlayInfo(A)).taHeight;
  await A.$eval(".composer textarea", (e) => e.focus());
  await A.keyboard.down("Shift");
  await A.keyboard.press("Enter");
  await A.keyboard.up("Shift");
  await A.type(".composer textarea", "second line");
  await sleep(100);
  const h2 = (await overlayInfo(A)).taHeight;
  check(h2 > h1, `textarea grows with the text (${h1}px -> ${h2}px)`);
}

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
  await A.$eval(".composer textarea", (e) => e.focus());
  await A.keyboard.down("Shift");
  await A.keyboard.press("Enter");
  await A.keyboard.up("Shift");
  await A.type(".composer textarea", piece);
  const v = await draft(A);
  const t = await A.$eval(
    ".composer textarea",
    (e) => e.parentElement.querySelector(".composer-overlay").textContent,
  );
  check(t === v, `overlay text equals the draft after appending "${piece}"`);
}
{
  const info = await overlayInfo(A);
  const v = await draft(A);
  check(
    v.includes("```") && info.overlay && info.overlay.text === v,
    "fences and newline edits stay in sync",
  );
  const styled = await A.$eval(".composer textarea", (e) => {
    const o = e.parentElement.querySelector(".composer-overlay");
    return {
      strong: o.querySelector("strong")?.textContent ?? null,
      em: o.querySelector("em")?.textContent ?? null,
      u: o.querySelector("u")?.textContent ?? null,
      s: o.querySelector("s")?.textContent ?? null,
      code: o.querySelector("code")?.textContent ?? null,
      quote: o.querySelector(".ov-quote")?.textContent ?? null,
      fence: o.querySelector(".ov-codeblock")?.textContent ?? null,
    };
  });
  check(styled.strong === "**foo**", "bold styled in the overlay");
  check(styled.em === "*bar*", "italic styled in the overlay");
  check(styled.u === "__baz__", "underline styled in the overlay");
  check(styled.s === "~~gone~~", "strike styled in the overlay");
  check(styled.code === "`code`", "inline code styled in the overlay");
  check(styled.quote === "> quote", "quote line styled in the overlay");
  check(
    styled.fence === "```\nx := 1\n```",
    "code fence styled in the overlay",
  );
}

// Styling must not change advance widths, or the styled text drifts away
// from the transparent textarea's caret: compare each styled element's
// rendered width with the same characters at the textarea's own font.
{
  const drift = await A.$eval(".composer textarea", (ta) => {
    const ov = ta.parentElement.querySelector(".composer-overlay");
    const cs = getComputedStyle(ta);
    const plainWidth = (text) => {
      const s = document.createElement("span");
      s.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`;
      s.textContent = text;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return ["strong", "em", "u", "s", "code"].map((sel) => {
      const el = ov.querySelector(sel);
      return [
        sel,
        Math.abs(el.getBoundingClientRect().width - plainWidth(el.textContent)),
      ];
    });
  });
  for (const [sel, d] of drift)
    check(
      d < 1,
      `overlay <${sel}> keeps the textarea's glyph widths (drift ${d.toFixed(2)}px)`,
    );
}

// The overlay follows the textarea's own scrolling — wheel/drag and the
// browser's scroll-to-caret — not just re-renders.
{
  const tops = () =>
    A.$eval(".composer textarea", (ta) => [
      ta.scrollTop,
      ta.parentElement.querySelector(".composer-overlay").scrollTop,
      ta.scrollHeight > ta.clientHeight,
    ]);
  await A.$eval(".composer textarea", (e) => {
    e.value = "";
    e.focus();
  });
  for (let i = 1; i <= 30; i++) {
    await A.keyboard.type(`line ${i}`);
    if (i < 30) {
      await A.keyboard.down("Shift");
      await A.keyboard.press("Enter");
      await A.keyboard.up("Shift");
    }
  }
  await sleep(200);
  let [ta, ov, overflow] = await tops();
  check(
    overflow && ta > 0 && ta === ov,
    `overlay scrolled with the caret (${ta}/${ov})`,
  );
  await A.$eval(".composer textarea", (e) => {
    e.scrollTop = 0;
  });
  await sleep(150);
  [ta, ov] = await tops();
  check(
    ta === 0 && ov === 0,
    `overlay follows a scroll with no typing (${ta}/${ov})`,
  );
  await A.keyboard.type("x");
  await sleep(150);
  [ta, ov] = await tops();
  check(
    ta > 0 && ta === ov,
    `overlay follows the scroll-to-caret after a keystroke (${ta}/${ov})`,
  );
}

// The @mention picker still opens on @ and inserts the handle.
await A.$eval(".composer textarea", (e) => (e.value = ""));
await A.type(".composer textarea", `@bea`);
await sleep(300);
check((await A.$(".mention-picker")) !== null, "mention picker opens on @");
await A.keyboard.press("Enter");
await sleep(200);
check((await draft(A)) === `@bea${suffix} `, "mention inserts the handle");
await A.keyboard.press("Backspace"); // drop the trailing space

// The toolbar Bold button still wraps the selection.
await A.$eval(".composer textarea", (e) => (e.value = ""));
await A.type(".composer textarea", "hi there");
await A.$eval(".composer textarea", (e) => {
  e.focus();
  e.select();
});
await A.click('.composer .format-button[aria-label="Bold"]');
await sleep(100);
check((await draft(A)) === "**hi there**", "toolbar bold wraps the selection");
check(
  await A.$eval(
    ".composer textarea",
    (e) => e.selectionStart === 2 && document.activeElement === e,
  ),
  "focus and selection survive the toolbar edit",
);

// Enter sends, and the message renders normally (no overlay elements in
// the rendered message, no raw markers in the rendered text).
await A.keyboard.press("Enter");
await sleep(700);
{
  const rendered = await A.$eval(".composer textarea", () => {
    const els = document.querySelectorAll(".message-content");
    const last = els[els.length - 1];
    return {
      strong: last.querySelector("strong")?.textContent ?? null,
      raw: last.textContent ?? "",
      overlayInMessage: last.querySelector(".composer-overlay") !== null,
    };
  });
  check(
    rendered.strong === "hi there",
    "sent message renders <strong> as before",
  );
  check(!rendered.raw.includes("**"), "rendered message has no raw markers");
  check(!rendered.overlayInMessage, "rendered message has no overlay");
  check((await draft(A)) === "", "composer cleared after send");
  check(
    (await B.$eval(
      ".message-content",
      (e) => e.querySelector("strong")?.textContent ?? null,
    )) === "hi there",
    "B sees the styled message live",
  );
}

// The inline editor shows the same styling.
await sleep(300);
{
  const rows = await A.$$(".message");
  await rows[0].hover();
  const btns = await rows[0].$$(".message-action");
  for (const b of btns)
    if ((await A.evaluate((e) => e.title, b)) === "Edit") {
      await b.click();
      break;
    }
  await sleep(300);
  const info = await overlayInfo(A, ".message-editor textarea");
  check(
    info.overlay &&
      info.overlay.text ===
        (await A.$eval(".message-editor textarea", (e) => e.value)),
    "inline editor overlay text equals its value",
  );
  const styled = await A.$eval(".message-editor textarea", (e) => {
    const o = e.parentElement.querySelector(".composer-overlay");
    return {
      strong: o.querySelector("strong")?.textContent ?? null,
      markers: o.querySelectorAll(".md-marker").length,
    };
  });
  check(
    styled.strong === "**hi there**",
    "inline editor shows the styled markers",
  );
  check(styled.markers === 2, "inline editor keeps both markers");
  await A.keyboard.press("Escape");
  await sleep(200);
}

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
