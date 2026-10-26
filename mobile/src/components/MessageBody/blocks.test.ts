import { describe, expect, it } from "vitest";
import { markdown } from "../../theme/generated";
import { type BodyBlock, blockGaps, type ListRow, parse, QUOTE_INDENT, rowIndent, spokenMarker } from "./blocks";
import { BODY_INSETS, paragraphWidth } from "./insets";
import { firstCovered, type Line, nodePath } from "./lines";

const kinds = (content: string) => parse(content).blocks.map((block) => block.type);

const rows = (content: string): ListRow[] => {
  const block = parse(content).blocks[0];
  if (block?.type !== "list") throw new Error(`no list in ${JSON.stringify(content)}`);
  return block.rows;
};

// Every spoiler path in a message, across its blocks.
function spoilerPaths(blocks: BodyBlock[]): string[] {
  const lines: Line[] = blocks.flatMap((block) =>
    block.type === "list" ? block.rows.map((row) => row.lines[0]) : block.type === "code" ? [] : block.lines,
  );
  const paths: string[] = [];
  for (const line of lines) {
    let path = firstCovered([line], (at) => !paths.includes(at));
    while (path !== undefined) {
      paths.push(path);
      path = firstCovered([line], (at) => !paths.includes(at));
    }
  }
  return paths;
}

describe("parse", () => {
  it("keeps the parser's blocks in order", () => {
    expect(kinds("hello\n> quoted\n- one\n```\ncode\n```\nafter")).toEqual(["lines", "quote", "list", "code", "lines"]);
  });

  it("keeps a code block's text literal: no mention, @here, link or mark", () => {
    const [block] = parse("```\nping @here **now** https://example.com\n```").blocks;
    expect(block).toEqual({ type: "code", text: "ping @here **now** https://example.com" });
  });

  it("draws no line for a line break before another block, as a browser does", () => {
    const [lines, code] = parse("Look:\n\n```\nx\n```").blocks;
    expect(lines.type === "lines" && lines.lines.length).toBe(1);
    expect(code.type).toBe("code");
    // An empty line between blocks draws nothing at all.
    expect(kinds("```a```\n\n```b```")).toEqual(["code", "code"]);
    // A line break after a block still starts a blank line.
    const after = parse("```a```\n\ntext").blocks[1];
    expect(after.type === "lines" && after.lines.length).toBe(2);
  });

  it("drops a quote's last empty line", () => {
    const [quote] = parse("> a\n>").blocks;
    expect(quote.type === "quote" && quote.lines.map((line) => line.path)).toEqual(["0.0"]);
  });

  it("starts every path with its block's index in the parse", () => {
    const { blocks } = parse("```a```\n\n||one||\n> ||two||\n- ||three||\n  - ||four||");
    expect(spoilerPaths(blocks)).toEqual(["1.1.0", "2.0.0", "3.0.0", "3.1.0"]);
  });

  it("gives the same spoiler in two blocks two paths", () => {
    const paths = spoilerPaths(parse("||same||\n> ||same||\n- ||same||").blocks);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(3);
  });

  it("marks a message of only emoji", () => {
    expect(parse("🌳🍂").emojiOnly).toBe(true);
    expect(parse("> 🌳").emojiOnly).toBe(false);
  });
});

describe("listRows", () => {
  it("bullets by depth, as a browser does: disc, circle, then square", () => {
    expect(rows("- a\n  - b\n    - c\n      - d").map((row) => [row.depth, row.marker])).toEqual([
      [0, "•"],
      [1, "◦"],
      [2, "▪"],
      [3, "▪"],
    ]);
  });

  it("numbers from one whatever the numbers written", () => {
    expect(rows("3. a\n7. b\n1) c").map((row) => row.marker)).toEqual(["1.", "2.", "3."]);
  });

  it("numbers nested rows on their own and carries on after them", () => {
    const markers = rows("1. a\n  1. a1\n  2. a2\n2. b\n  - b1\n3. c").map((row) => row.marker);
    expect(markers).toEqual(["1.", "1.", "2.", "2.", "◦", "3."]);
  });

  it("starts the numbers again after a bulleted sibling, as a new list", () => {
    expect(rows("1. a\n- b\n1. c").map((row) => row.marker)).toEqual(["1.", "•", "1."]);
  });

  it("never goes more than one level deeper than the row before", () => {
    expect(rows("- top\n      - deep\n      - deep again").map((row) => row.depth)).toEqual([0, 1, 2]);
  });

  it("reads a number as itself and every bullet as one", () => {
    const [one, , bullet] = rows("1. a\n  - b\n    - c");
    expect(spokenMarker(one)).toBe("1. ");
    expect(spokenMarker(bullet)).toBe("• ");
  });
});

describe("widths", () => {
  it("measures a paragraph at the place's width less its block's room", () => {
    expect(paragraphWidth(400, "row", 0)).toBe(400 - BODY_INSETS.row);
    expect(paragraphWidth(400, "menuCard", QUOTE_INDENT)).toBe(
      400 - BODY_INSETS.menuCard - markdown.quoteBarWidth - 2 * markdown.quotePadX,
    );
    expect(paragraphWidth(400, "row", rowIndent(2))).toBe(400 - BODY_INSETS.row - 3 * markdown.listIndent);
  });
});

describe("blockGaps", () => {
  it("collapses neighbouring margins into the larger, as a browser does", () => {
    const { blocks } = parse("words\n```a```\n> q\n- l");
    expect(blockGaps(blocks)).toEqual({
      before: [
        0,
        markdown.preMarginY,
        Math.max(markdown.preMarginY, markdown.quoteMarginY),
        Math.max(markdown.quoteMarginY, markdown.listMarginY),
      ],
      after: markdown.listMarginY,
    });
  });

  it("gives a message of lines no gaps", () => {
    expect(blockGaps(parse("a\nb").blocks)).toEqual({ before: [0], after: 0 });
  });
});

describe("nodePath", () => {
  it("is the parent's path and the index", () => {
    expect(nodePath("2.0", 3)).toBe("2.0.3");
  });
});
