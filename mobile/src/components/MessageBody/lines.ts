import type { Inline } from "@stoop/core/markdown";
import { type MentionChannels, type MentionRef, mentionText } from "@stoop/core/mentions";

export type Node = Inline;

// One line of a paragraph: its inlines and its place in the message (the
// block's index, then the line's), from which every node's path follows.
export type Line = { path: string; nodes: Node[] };

// A spoiler's place in the message, the same for every drawing of the
// same content: the block's index, the line's, then each node's down to
// it. Spoilers are revealed by it and links keyed by it (native.ts).
export const nodePath = (parent: string, index: number) => `${parent}.${index}`;

// A mention's words as the message draws them: a channel the screen
// lists by its current name, anything else as its token's handle.
export function mentionWords(ref: MentionRef, channels: MentionChannels | undefined): string {
  const channel = ref.kind === "channel" ? channels?.get(ref.id) : undefined;
  return channel ? `#${channel.name}` : mentionText(ref);
}

// A paragraph as a screen reader says it while a spoiler in it is
// covered: the spoiler's words are not said, `cover` is. Mentions read
// as `words` gives them, the words drawn.
export function spoken(
  lines: Line[],
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
  return lines.map((line) => walk(line.nodes, line.path)).join("\n");
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

// Whether any spoiler in a paragraph is still covered.
export function anyCovered(lines: Line[], isCovered: (path: string) => boolean): boolean {
  return lines.some((line) => coveredIn(line.nodes, line.path, isCovered));
}

// The path of a paragraph's first covered spoiler in reading order, the
// outermost where one covers another: what activating it reveals.
export function firstCovered(lines: Line[], isCovered: (path: string) => boolean): string | undefined {
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
  for (const line of lines) {
    const found = find(line.nodes, line.path);
    if (found) return found;
  }
  return undefined;
}
