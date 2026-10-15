import { tokensAsText } from "../mentions";
import { parseInline } from "./inline";
import type { Block, Inline, ListItem } from "./types";

// Blocks, a line at a time: fenced code, "> " quotes, "- "/"1. " lists, and
// plain lines. Each reader takes the run of lines its block owns and says
// where the next block starts.

const FENCE_OPEN = /^\s*```(\w*)\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const FENCE_ONE_LINE = /^\s*```(.+?)```\s*$/;
const QUOTE = /^>\s?(.*)$/;
// "- item", "* item", "1. item", "1) item", with up to six leading spaces
// for nesting. A bullet must be followed by a space, so *italic* at the
// start of a line is still italic.
const LIST = /^( {0,6})([-*]|\d{1,9}[.)])\s+(.*)$/;
// Two spaces a level, three levels deep — enough to be useful, shallow
// enough that a wrapped paste doesn't produce a staircase.
const MAX_LIST_DEPTH = 3;

type Read = { block: Block; next: number };

export function parseMarkdown(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const read =
      readCodeblock(lines, i) ??
      readList(lines, i) ??
      readQuote(lines, i) ??
      readLines(lines, i);
    blocks.push(read.block);
    i = read.next;
  }
  return blocks;
}

// A fence and everything to its closing fence, or to the end while it is
// still open. A fence whose code is all on its own line is one block.
function readCodeblock(lines: string[], start: number): Read | null {
  const one = lines[start].match(FENCE_ONE_LINE);
  if (one) {
    return {
      block: { type: "codeblock", text: tokensAsText(one[1]), lang: "" },
      next: start + 1,
    };
  }
  const open = lines[start].match(FENCE_OPEN);
  if (!open) return null;
  let end = start + 1;
  while (end < lines.length && !FENCE_CLOSE.test(lines[end])) end++;
  return {
    block: {
      type: "codeblock",
      text: tokensAsText(lines.slice(start + 1, end).join("\n")),
      lang: open[1],
    },
    next: end + 1,
  };
}

// Consecutive list rows, bullets and numbers alike: the renderer decides
// where one <ul>/<ol> ends and the next begins, so a numbered item can
// have bulleted children.
function readList(lines: string[], start: number): Read | null {
  const items: ListItem[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const m = lines[i].match(LIST);
    if (!m) break;
    const [, indent, bullet, rest] = m;
    items.push({
      ordered: /\d/.test(bullet[0]),
      depth: Math.min(MAX_LIST_DEPTH, Math.floor(indent.length / 2)),
      content: parseInline(rest),
    });
  }
  return items.length > 0 ? { block: { type: "list", items }, next: i } : null;
}

function readQuote(lines: string[], start: number): Read | null {
  const quoted: Inline[][] = [];
  let i = start;
  for (; i < lines.length && !startsOther(lines[i], "quote"); i++) {
    const m = lines[i].match(QUOTE);
    if (!m) break;
    quoted.push(parseInline(m[1]));
  }
  return quoted.length > 0
    ? { block: { type: "quote", lines: quoted }, next: i }
    : null;
}

// Plain lines up to the next line that starts any other block. Always
// reads at least one, so an empty message is one empty line.
function readLines(lines: string[], start: number): Read {
  const plain = [parseInline(lines[start])];
  let i = start + 1;
  for (; i < lines.length && !startsOther(lines[i], "lines"); i++) {
    plain.push(parseInline(lines[i]));
  }
  return { block: { type: "lines", lines: plain }, next: i };
}

// Whether a line starts a block other than `kind`, checked in the order
// parseMarkdown tries them.
function startsOther(line: string, kind: "quote" | "lines"): boolean {
  return (
    FENCE_ONE_LINE.test(line) ||
    FENCE_OPEN.test(line) ||
    LIST.test(line) ||
    (kind !== "quote" && QUOTE.test(line))
  );
}
