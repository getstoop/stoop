import { emojiOnly } from "@stoop/core/emojiText";
import { type Inline, type ListItem, parseMarkdown } from "@stoop/core/markdown";
// Straight from the generated values, not the theme's index, so this
// file needs no React Native and its tests run in Node.
import { markdown } from "../../theme/generated";
import { type Line, nodePath } from "./lines";

// A message as web's MessageBody lays it out: a column of blocks from
// the shared parser. Lines and quotes are paragraphs; a list is its rows,
// each one line at its depth with its marker; a code block is its text,
// never Markdown.
export type ListRow = {
  depth: number;
  ordered: boolean;
  // What the browser draws before the row: "1." or a bullet by depth.
  marker: string;
  // Its one line, as a paragraph takes it.
  lines: [Line];
};

export type BodyBlock =
  | { type: "lines"; lines: Line[] }
  | { type: "quote"; lines: Line[] }
  | { type: "list"; rows: ListRow[] }
  | { type: "code"; text: string };

export type Parsed = {
  blocks: BodyBlock[];
  // Nothing but emoji, drawn large (core/emojiText). Only ever one
  // paragraph: a block's markers are not emoji.
  emojiOnly: boolean;
};

// A browser's bullets for a list inside none, one, or two or more others.
const BULLETS = ["•", "◦", "▪"];

const empty = (nodes: Inline[]) => nodes.every((node) => node.type === "text" && node.text === "");

// A block's lines with their paths. A line break with nothing after it
// before the block ends draws no line in a browser, so a trailing empty
// line goes when another block follows (or the quote it is in ends).
function toLines(lines: Inline[][], at: string, closed: boolean): Line[] {
  const all = lines.map((nodes, index) => ({ path: nodePath(at, index), nodes }));
  return closed && all.length > 0 && empty(all[all.length - 1].nodes) ? all.slice(0, -1) : all;
}

// Every path starts with the block's index in the parse, so they are
// unique across blocks and stay put when an earlier block draws nothing.
export function parse(content: string): Parsed {
  const parsed = parseMarkdown(content);
  const blocks: BodyBlock[] = [];
  parsed.forEach((block, index) => {
    const at = String(index);
    switch (block.type) {
      case "lines": {
        const lines = toLines(block.lines, at, index < parsed.length - 1);
        if (lines.length > 0) blocks.push({ type: "lines", lines });
        return;
      }
      case "quote":
        blocks.push({ type: "quote", lines: toLines(block.lines, at, true) });
        return;
      case "list":
        blocks.push({ type: "list", rows: listRows(block.items, at) });
        return;
      case "codeblock":
        blocks.push({ type: "code", text: block.text });
        return;
    }
  });
  return { blocks, emojiOnly: emojiOnly(content) };
}

// The parser's flat rows as web's List nests them: a row never more than
// one level below the one before, numbered within its run of numbered
// siblings (a bulleted sibling or the parent ends a run), bulleted by
// how many lists it is inside.
export function listRows(items: ListItem[], at: string): ListRow[] {
  const base = items[0]?.depth ?? 0;
  const rows: ListRow[] = [];
  for (const [index, item] of items.entries()) {
    const previous = rows.at(-1)?.depth ?? -1;
    const depth = Math.max(0, Math.min(item.depth - base, previous + 1));
    let number = 1;
    for (let before = rows.length - 1; item.ordered && before >= 0; before--) {
      const row = rows[before];
      if (row.depth < depth || (row.depth === depth && !row.ordered)) break;
      if (row.depth === depth) number++;
    }
    rows.push({
      depth,
      ordered: item.ordered,
      marker: item.ordered ? `${number}.` : BULLETS[Math.min(depth, BULLETS.length - 1)],
      lines: [{ path: nodePath(at, index), nodes: item.content }],
    });
  }
  return rows;
}

// How a row's marker is read before its words: its number, or one word
// for every bullet ("•" is read as "bullet").
export const spokenMarker = (row: ListRow) => (row.ordered ? `${row.marker} ` : "• ");

// The room each block takes beside its words, in web's values: the one
// source for the block's View (Quote, List) and the width its paragraph
// is measured at (paragraphWidth).
export const QUOTE_INDENT = markdown.quoteBarWidth + 2 * markdown.quotePadX;
export const rowIndent = (depth: number) => (depth + 1) * markdown.listIndent;

// The space above each block and below the last, as a browser collapses
// adjacent vertical margins into the larger one. Lines have none.
const MARGIN = {
  lines: 0,
  quote: markdown.quoteMarginY,
  list: markdown.listMarginY,
  code: markdown.preMarginY,
} as const;

export function blockGaps(blocks: BodyBlock[]): { before: number[]; after: number } {
  const before = blocks.map((block, index) =>
    Math.max(MARGIN[block.type], index > 0 ? MARGIN[blocks[index - 1].type] : 0),
  );
  const last = blocks.at(-1);
  return { before, after: last ? MARGIN[last.type] : 0 };
}
