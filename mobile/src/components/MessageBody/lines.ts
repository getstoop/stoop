import { emojiOnly } from "@stoop/core/emojiText";
import { type Inline, parseMarkdown } from "@stoop/core/markdown";
import { type MentionChannels, type MentionRef, mentionText } from "@stoop/core/mentions";

// A code block's line: its text as written, never a mention or an
// @channel or @here, drawn plainly until code blocks are drawn as blocks.
export type Literal = { type: "literal"; text: string };
export type Node = Inline | Literal;

export type Parsed = {
  // The message's lines, each a run of inlines. Quotes and lists read as
  // their lines with their marks, a code block as its literal text, until
  // they are drawn as blocks.
  lines: Node[][];
  // Nothing but emoji, drawn large (core/emojiText).
  emojiOnly: boolean;
};

export function parse(content: string): Parsed {
  const lines = parseMarkdown(content).flatMap((block): Node[][] => {
    if (block.type === "codeblock") return [[{ type: "literal", text: block.text }]];
    return block.type === "list" ? block.items.map((item) => item.content) : block.lines;
  });
  return { lines, emojiOnly: emojiOnly(content) };
}

// A spoiler's place in the message, the same for every drawing of the
// same content: the line's index, then each node's down to it.
export const nodePath = (parent: string, index: number) => `${parent}.${index}`;
export const linePath = (index: number) => String(index);

// A mention's words as the message draws them: a channel the screen
// lists by its current name, anything else as its token's handle.
export function mentionWords(ref: MentionRef, channels: MentionChannels | undefined): string {
  const channel = ref.kind === "channel" ? channels?.get(ref.id) : undefined;
  return channel ? `#${channel.name}` : mentionText(ref);
}

// The message as a screen reader says it while a spoiler in it is
// covered: the spoiler's words are not said, `cover` is. Mentions read
// as `words` gives them, the words drawn.
export function spoken(
  lines: Node[][],
  isCovered: (path: string) => boolean,
  cover: string,
  words: (ref: MentionRef) => string = mentionText,
): string {
  const walk = (nodes: Node[], parent: string): string =>
    nodes
      .map((node, index) => {
        const path = nodePath(parent, index);
        switch (node.type) {
          case "text":
          case "code":
          case "literal":
            return node.text;
          case "mention":
            return words(node.mention);
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
export function coveredIn(nodes: Node[], parent: string, isCovered: (path: string) => boolean): boolean {
  return nodes.some((node, index) => {
    const path = nodePath(parent, index);
    if (node.type === "spoiler") return isCovered(path) || coveredIn(node.children, path, isCovered);
    if (node.type === "link") return !!node.label && coveredIn(node.label, path, isCovered);
    return "children" in node && coveredIn(node.children, path, isCovered);
  });
}

// Whether any spoiler in the message is still covered.
export function anyCovered(lines: Node[][], isCovered: (path: string) => boolean): boolean {
  return lines.some((line, index) => coveredIn(line, linePath(index), isCovered));
}

// The path of the first covered spoiler in reading order, the outermost
// where one covers another: what activating the message reveals.
export function firstCovered(lines: Node[][], isCovered: (path: string) => boolean): string | undefined {
  const find = (nodes: Node[], parent: string): string | undefined => {
    for (const [index, node] of nodes.entries()) {
      const path = nodePath(parent, index);
      if (node.type === "spoiler" && isCovered(path)) return path;
      const inner = node.type === "link" ? node.label : "children" in node ? node.children : undefined;
      const found = inner && find(inner, path);
      if (found) return found;
    }
    return undefined;
  };
  for (const [index, line] of lines.entries()) {
    const found = find(line, linePath(index));
    if (found) return found;
  }
  return undefined;
}
