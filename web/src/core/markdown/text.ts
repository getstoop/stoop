import { mentionText } from "../mentions";
import { parseMarkdown } from "./blocks";
import type { Block, Inline } from "./types";

// What other features read out of a message without rendering it.

// The message's words with their lines kept, for copying a message as
// text: a mention as its @handle or #name, a link as its words or else
// its address, a blank line between paragraphs, a list as its items one
// to a line (the bullets and their nesting are markup), a fence as its
// code. A spoiler's words are copied: the person asked for the text. A
// quoted line keeps its "> ", so another's words are not handed on as
// the reader's own; everything else drops its marks.
export function plainLines(content: string): string {
  return textLines(content, (line) => `> ${line}`);
}

// The message with its markup removed, for one-line previews (reply bar,
// activity previews). Mirrors plainText on the server.
export function plainText(content: string): string {
  return oneLine(textLines(content, (line) => line));
}

// The same with a spoiler's words covered: "spoiler" stands where they
// would be, for a label read aloud over a row that draws them covered
// (the phone's search result), which plainText would give away.
export function previewText(content: string): string {
  return oneLine(textLines(content, (line) => line, true));
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

// Each block's lines of words, blocks and lines joined by newlines; a
// quote's lines through quoted, a spoiler's words covered when asked.
function textLines(
  content: string,
  quoted: (line: string) => string,
  covered = false,
): string {
  return parseMarkdown(content)
    .map((b) => {
      if (b.type === "codeblock") return b.text;
      const lines = lineRuns(b).map((run) => inlineText(run, covered));
      return (b.type === "quote" ? lines.map(quoted) : lines).join("\n");
    })
    .join("\n");
}

// No words and no mention: only markers, like an empty quote, bullet or
// code block. Such a message isn't sent. Check before trimming: a trimmed
// "- " is a typed dash.
export function isBlankMessage(content: string): boolean {
  return plainText(content) === "";
}

// The distinct links in a message, in order of appearance. Mirrors
// extractLinks on the server, without its cap.
export function linksIn(content: string): string[] {
  const found = new Set<string>();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === "link") found.add(n.href);
      else if ("children" in n) walk(n.children);
    }
  };
  for (const b of parseMarkdown(content)) {
    if (b.type !== "codeblock") for (const run of lineRuns(b)) walk(run);
  }
  return [...found];
}

// A block's lines of inline content. A list reads as its items; the
// bullets themselves are markup.
function lineRuns(b: Exclude<Block, { type: "codeblock" }>): Inline[][] {
  return b.type === "list" ? b.items.map((it) => it.content) : b.lines;
}

function inlineText(nodes: Inline[], covered = false): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.text;
        case "link":
          return n.label ? inlineText(n.label, covered) : n.href;
        case "mention":
          return mentionText(n.mention);
        case "spoiler":
          return covered ? "spoiler" : inlineText(n.children);
        default:
          return inlineText(n.children, covered);
      }
    })
    .join("");
}
