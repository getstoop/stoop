import { emojiOnly } from "@stoop/core/emojiText";
import { type Inline, parseMarkdown } from "@stoop/core/markdown";
import { mentionText } from "@stoop/core/mentions";

export type Parsed = {
  // The message's lines, each a run of inlines. Quotes and lists read as
  // their lines with their marks, a code block as its plain text, until
  // they are drawn as blocks.
  lines: Inline[][];
  // Nothing but emoji, drawn large (core/emojiText).
  emojiOnly: boolean;
};

export function parse(content: string): Parsed {
  const lines = parseMarkdown(content).flatMap((block): Inline[][] => {
    if (block.type === "codeblock") return [[{ type: "text", text: block.text }]];
    return block.type === "list" ? block.items.map((item) => item.content) : block.lines;
  });
  return { lines, emojiOnly: emojiOnly(content) };
}

// A spoiler's place in the message, the same for every drawing of the
// same content: the line's index, then each node's down to it.
export const nodePath = (parent: string, index: number) => `${parent}.${index}`;
export const linePath = (index: number) => String(index);

// The message as a screen reader says it while a spoiler in it is
// covered: the spoiler's words are not said, `cover` is.
export function spoken(lines: Inline[][], isCovered: (path: string) => boolean, cover: string): string {
  const walk = (nodes: Inline[], parent: string): string =>
    nodes
      .map((node, index) => {
        const path = nodePath(parent, index);
        switch (node.type) {
          case "text":
          case "code":
            return node.text;
          case "mention":
            return mentionText(node.mention);
          case "link":
            return node.label ? walk(node.label, path) : node.href;
          case "spoiler":
            return isCovered(path) ? cover : walk(node.children, path);
          default:
            return walk(node.children, path);
        }
      })
      .join("");
  return lines.map((line, index) => walk(line, linePath(index))).join("\n");
}

// Whether any spoiler among these nodes, at parent, is still covered.
export function coveredIn(nodes: Inline[], parent: string, isCovered: (path: string) => boolean): boolean {
  return nodes.some((node, index) => {
    const path = nodePath(parent, index);
    if (node.type === "spoiler") return isCovered(path) || coveredIn(node.children, path, isCovered);
    if (node.type === "link") return !!node.label && coveredIn(node.label, path, isCovered);
    return "children" in node && coveredIn(node.children, path, isCovered);
  });
}

// Whether any spoiler in the message is still covered.
export function anyCovered(lines: Inline[][], isCovered: (path: string) => boolean): boolean {
  return lines.some((line, index) => coveredIn(line, linePath(index), isCovered));
}
