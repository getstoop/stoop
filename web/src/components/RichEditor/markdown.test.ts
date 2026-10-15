import { describe, expect, it } from "vitest";
import { fromMarkdown, type JSONContent, toMarkdown } from "./markdown";

describe("rich editor Markdown round trip", () => {
  it.each([
    "plain words",
    "**bold** and *italic*",
    "__under__ ~~strike~~ ||spoiler|| `code`",
    "***both***",
    "**bold with *italic* inside**",
    "**bold ending in *italic***",
    "***italic* starting bold**",
    "*italic* ***both*** *italic*",
    "see [the words](https://example.com/a?b=c) here",
    "[**styled** words](https://example.com)",
    "a bare https://example.com/path link",
    "an address with markup https://example.com/a_b__c*d~e|f link",
    "@user_name and @casey",
    "> a quote\n> two lines",
    "- one\n- two\n  - nested\n    - deeper\n- three",
    "1. one\n2. two\n  - bullet child",
    "```js\nconst x = 1;\n\nreturn x;\n```",
    "```c++\nint x;\n```\nafter",
    "before\n\nafter a blank line",
    "a \\*literal\\* star and a \\| pipe",
    "\\- not a list",
    "1\\. not a list",
  ])("%j", (md) => {
    expect(toMarkdown(fromMarkdown(md))).toBe(md);
  });

  it("moves whitespace outside the markers", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold ", marks: [{ type: "bold" }] },
            { type: "text", text: "plain" },
          ],
        },
      ],
    };
    expect(toMarkdown(doc)).toBe("**bold** plain");
  });

  it("writes bold ending in italic so it reads back", () => {
    const bold = { type: "bold" };
    const italic = { type: "italic" };
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hello ", marks: [bold] },
            { type: "text", text: "world", marks: [bold, italic] },
          ],
        },
      ],
    };
    expect(toMarkdown(doc)).toBe("**hello *world***");
    expect(fromMarkdown(toMarkdown(doc))).toEqual(doc);
  });

  it.each([
    ["1. not a list", "1\\. not a list"],
    ["2023. was a year", "2023\\. was a year"],
    ["4) also not", "4\\) also not"],
    ["  - indented dash", "  \\- indented dash"],
    ["   12. indented number", "   12\\. indented number"],
    ["-\ttabbed dash", "\\-\ttabbed dash"],
  ])("keeps the paragraph %j a paragraph", (words, md) => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: words }] },
      ],
    };
    expect(toMarkdown(doc)).toBe(md);
    expect(fromMarkdown(toMarkdown(doc))).toEqual(doc);
  });

  const line = (...content: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content }],
  });
  const link = { type: "link", attrs: { href: "https://x.com" } };
  const code = { type: "code" };

  it("keeps a ] in link words", () => {
    const doc = line({ type: "text", text: "a]b", marks: [link] });
    expect(toMarkdown(doc)).toBe("[a\\]b](https://x.com)");
    expect(fromMarkdown(toMarkdown(doc))).toEqual(doc);
  });

  it("keeps a link whose address has balanced brackets", () => {
    const wiki = { type: "link", attrs: { href: "https://x.com/a_(b)" } };
    const doc = line({ type: "text", text: "words", marks: [wiki] });
    expect(fromMarkdown(toMarkdown(doc))).toEqual(doc);
  });

  it("writes a backtick in code beside the code", () => {
    const doc = line({ type: "text", text: "a`b", marks: [code] });
    expect(toMarkdown(doc)).toBe("`a`\\``b`");
    expect(fromMarkdown(toMarkdown(doc))).toEqual(
      line(
        { type: "text", text: "a", marks: [code] },
        { type: "text", text: "`" },
        { type: "text", text: "b", marks: [code] },
      ),
    );
  });

  it("writes a bracket in code in link words beside the code", () => {
    const doc = line({ type: "text", text: "a]b", marks: [link, code] });
    expect(fromMarkdown(toMarkdown(doc))).toEqual(
      line(
        { type: "text", text: "a", marks: [link, code] },
        { type: "text", text: "]", marks: [link] },
        { type: "text", text: "b", marks: [link, code] },
      ),
    );
  });

  it("escapes markup typed as text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "2 * 3 = 6 [sic]" }],
        },
      ],
    };
    expect(toMarkdown(doc)).toBe("2 \\* 3 = 6 \\[sic]");
  });
});
