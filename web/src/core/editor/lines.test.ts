import { describe, expect, it } from "vitest";
import {
  docToLines,
  type EditorLine,
  type EditorMark,
  linesToDoc,
} from "./lines";
import { fromMarkdown, toMarkdown } from "./markdown";

const ID = "00000000-0000-4000-8000-000000000001";
const casey = { kind: "person" as const, id: ID, handle: "casey" };
const linesOf = (md: string) => docToLines(fromMarkdown(md));

describe("lines and Markdown, both ways", () => {
  it.each([
    "plain words",
    "**bold** and *italic*",
    "__under__ ~~strike~~ ||spoiler|| `code`",
    "**bold with *italic* inside**",
    "see [the words](https://example.com/a?b=c) here",
    "[**styled** words](https://example.com)",
    "a bare https://example.com/path link",
    `hi <@u:${ID}:casey> and **<@u:${ID}:casey>**`,
    "> a quote\n> two lines",
    "> a quote\nafter it",
    "- one\n- two\n  - nested\n    - deeper\n- three",
    "1. one\n2. two\n  - bullet child",
    "- bullets\n\n1. then numbers",
    "```js\nconst x = 1;\n\nreturn x;\n```",
    "```\n```",
    "```\na\n```\n```\nb\n```",
    "before\n\nafter a blank line",
    "a \\*literal\\* star and a \\| pipe",
    "\\- not a list",
  ])("%j", (md) => {
    const lines = linesOf(md);
    expect(toMarkdown(linesToDoc(lines))).toBe(toMarkdown(fromMarkdown(md)));
    expect(docToLines(linesToDoc(lines))).toEqual(lines);
  });
});

describe("docToLines", () => {
  it("gives a paragraph's runs their marks and link", () => {
    expect(linesOf("**a** [b *c*](https://x.example)")).toEqual([
      {
        block: "paragraph",
        depth: 0,
        group: 0,
        runs: [
          { text: "a", marks: ["bold"] },
          { text: " ", marks: [] },
          { text: "b ", marks: [], href: "https://x.example" },
          { text: "c", marks: ["italic"], href: "https://x.example" },
        ],
      },
    ]);
  });

  it("keeps a mention one run", () => {
    expect(linesOf(`hi <@u:${ID}:casey>`)[0].runs).toEqual([
      { text: "hi ", marks: [] },
      { mention: casey, marks: [] },
    ]);
  });

  it("tells a quote's lines from the paragraph after it", () => {
    const lines = linesOf("> a\n> b\nc");
    expect(lines.map((l) => [l.block, l.group])).toEqual([
      ["quote", 0],
      ["quote", 0],
      ["paragraph", 1],
    ]);
  });

  it("gives each list line its level", () => {
    const lines = linesOf("- a\n  1. b\n    - c\n- d");
    expect(lines.map((l) => [l.block, l.depth, l.group])).toEqual([
      ["bullet", 0, 0],
      ["ordered", 1, 0],
      ["bullet", 2, 0],
      ["bullet", 0, 0],
    ]);
  });

  it("splits a code block into its lines, blank ones included", () => {
    expect(linesOf("```go\na\n\nb\n```")).toEqual([
      {
        block: "code",
        depth: 0,
        group: 0,
        lang: "go",
        runs: [{ text: "a", marks: [] }],
      },
      { block: "code", depth: 0, group: 0, lang: "go", runs: [] },
      {
        block: "code",
        depth: 0,
        group: 0,
        lang: "go",
        runs: [{ text: "b", marks: [] }],
      },
    ]);
  });
});

describe("linesToDoc", () => {
  const code = (text: string, group: number): EditorLine => ({
    block: "code",
    depth: 0,
    group,
    runs: [{ text, marks: [] }],
  });

  it("keeps two code blocks apart by group", () => {
    expect(toMarkdown(linesToDoc([code("a", 0), code("b", 1)]))).toBe(
      "```\na\n```\n```\nb\n```",
    );
    expect(toMarkdown(linesToDoc([code("a", 0), code("b", 0)]))).toBe(
      "```\na\nb\n```",
    );
  });

  it("opens a list inside the item before a deeper line", () => {
    const item = (
      block: "bullet" | "ordered",
      depth: number,
      text: string,
    ) => ({
      block,
      depth,
      group: 0,
      runs: [{ text, marks: [] }],
    });
    expect(
      toMarkdown(
        linesToDoc([
          item("bullet", 0, "a"),
          item("ordered", 1, "b"),
          item("bullet", 0, "c"),
        ]),
      ),
    ).toBe("- a\n  1. b\n- c");
  });

  it("writes a mention as its token, and as words in code", () => {
    const line = (marks: EditorLine["runs"][number]["marks"]): EditorLine => ({
      block: "paragraph",
      depth: 0,
      group: 0,
      runs: [{ mention: casey, marks }],
    });
    expect(toMarkdown(linesToDoc([line([])]))).toBe(`<@u:${ID}:casey>`);
    expect(toMarkdown(linesToDoc([line(["code"])]))).toBe("`@casey`");
  });

  it("makes no lines an empty document", () => {
    expect(linesToDoc([])).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(toMarkdown(linesToDoc([]))).toBe("");
  });
});

// What the native editor hands over, as it would after its own edits:
// lines that Markdown keeps as they are.
describe("lines through Markdown and back", () => {
  const run = (text: string, marks: EditorMark[] = [], href?: string) =>
    href ? { text, marks, href } : { text, marks };
  const at = (
    block: EditorLine["block"],
    group: number,
    runs: EditorLine["runs"],
    depth = 0,
  ): EditorLine => ({ block, depth, group, runs });
  const through = (lines: EditorLine[]) =>
    docToLines(fromMarkdown(toMarkdown(linesToDoc(lines))));

  it.each<[string, EditorLine[]]>([
    [
      "marks, a link and a mention",
      [
        at("paragraph", 0, [
          run("bold", ["bold"]),
          run(" "),
          run("linked", ["italic"], "https://x.example"),
          run(" "),
          { mention: casey, marks: ["strike"] },
        ]),
      ],
    ],
    [
      "a quote, a list and a code block",
      [
        at("quote", 0, [run("quoted")]),
        at("bullet", 1, [run("a")]),
        at("ordered", 1, [run("b")], 1),
        at("bullet", 1, [run("c")], 2),
        at("bullet", 1, [run("d")]),
        { ...at("code", 2, [run("x = 1")]), lang: "py" },
        { ...at("code", 2, []), lang: "py" },
      ],
    ],
    [
      "a blank line, and markers typed as words",
      [
        at("paragraph", 0, [run("**not bold** - `nor code`")]),
        at("paragraph", 1, []),
        at("paragraph", 2, [run("- not a list")]),
      ],
    ],
  ])("%s", (_, lines) => {
    expect(through(lines)).toEqual(lines);
  });

  it("holds each list level to what Markdown reads back", () => {
    const items = (...depths: number[]) =>
      depths.map((depth) => at("bullet", 0, [run("x")], depth));
    for (const lines of [items(1, 3, 5), items(0, 1, 2, 3, 4), items(0, 2)]) {
      const direct = docToLines(linesToDoc(lines));
      expect(direct).toEqual(through(lines));
    }
    expect(
      docToLines(linesToDoc(items(0, 1, 2, 3, 4))).map((l) => l.depth),
    ).toEqual([0, 1, 2, 3, 3]);
  });
});
