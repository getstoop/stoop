import { describe, expect, it } from "vitest";
import { fromMarkdown, toMarkdown } from "./markdown";

describe("rich editor Markdown round trip", () => {
  it.each([
    "plain words",
    "**bold** and *italic*",
    "__under__ ~~strike~~ ||spoiler|| `code`",
    "***both***",
    "**bold with *italic* inside**",
    "see [the words](https://example.com/a?b=c) here",
    "[**styled** words](https://example.com)",
    "a bare https://example.com/path link",
    "an address with markup https://example.com/a_b__c*d~e|f link",
    "@user_name and @casey",
    "> a quote\n> two lines",
    "- one\n- two\n  - nested\n    - deeper\n- three",
    "1. one\n2. two\n  - bullet child",
    "```js\nconst x = 1;\n\nreturn x;\n```",
    "before\n\nafter a blank line",
    "a \\*literal\\* star and a \\| pipe",
    "\\- not a list",
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
