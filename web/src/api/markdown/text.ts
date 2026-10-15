import { parseMarkdown } from "./blocks";
import type { Block, Inline } from "./types";

// What other features read out of a message without rendering it.

// The message with its markup removed, for one-line previews (reply bar,
// activity previews). Mirrors plainText on the server.
export function plainText(content: string): string {
  return parseMarkdown(content)
    .map((b) => {
      if (b.type === "codeblock") return b.text;
      return lineRuns(b).map(inlineText).join("\n");
    })
    .join("\n")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

// No words and no mention: only markers, like an empty quote, bullet or
// code block. Such a message isn't sent. Check before trimming: a trimmed
// "- " is a typed dash.
export function isBlankMessage(content: string): boolean {
  return plainText(content) === "";
}

// The distinct links in a message, in order of appearance, leaving out a
// link in a spoiler or whose words hold one. Mirrors extractLinks on the
// server, without its cap.
export function linksIn(content: string): string[] {
  const found = new Set<string>();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === "link") {
        if (!holdsSpoiler(n.label ?? [])) found.add(n.href);
      } else if (n.type !== "spoiler" && "children" in n) walk(n.children);
    }
  };
  for (const b of parseMarkdown(content)) {
    if (b.type !== "codeblock") for (const run of lineRuns(b)) walk(run);
  }
  return [...found];
}

function holdsSpoiler(nodes: Inline[]): boolean {
  return nodes.some(
    (n) =>
      n.type === "spoiler" ||
      ("children" in n && holdsSpoiler(n.children)) ||
      (n.type === "link" && holdsSpoiler(n.label ?? [])),
  );
}

// A block's lines of inline content. A list reads as its items; the
// bullets themselves are markup.
function lineRuns(b: Exclude<Block, { type: "codeblock" }>): Inline[][] {
  return b.type === "list" ? b.items.map((it) => it.content) : b.lines;
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.text;
        case "link":
          return n.label ? inlineText(n.label) : n.href;
        case "mention":
          return `@${n.mention.handle}`;
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}
