import { type MentionRef, mentionText } from "../mentions";
import type { JSONContent } from "./markdown";

// The editor's document as the phone's native editor holds it: one entry
// per line, each with its block and its styled runs. Native text is a run
// of paragraphs, not a tree, so quotes, lists and code blocks are told
// apart by each line's block, and which lines belong together by group.
// toMarkdown and fromMarkdown stay the one reader and writer: these turn
// lines into the document they work on, and back
// (docs/proposals/mobile-rich-editor.md → The document as lines).

export type EditorMark =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "spoiler";

// A mention is never linked: in a link's words the format reads a token
// as its @handle, as text.
export type EditorRun =
  | { text: string; marks: EditorMark[]; href?: string }
  | { mention: MentionRef; marks: EditorMark[] };

export interface EditorLine {
  block: "paragraph" | "quote" | "bullet" | "ordered" | "code";
  // A list item's level, 0 to 3, at most one deeper than the line before
  // (linesToDoc holds it there); 0 for every other line.
  depth: number;
  // Lines of one quote, one list or one code block share it. Only code
  // keeps two blocks side by side apart: Markdown runs two quotes, or
  // two lists of a kind, together, and so does linesToDoc.
  group: number;
  // A code block's language, on each of its lines; the first line's is
  // the block's.
  lang?: string;
  runs: EditorRun[];
}

const MARKS: readonly string[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "spoiler",
];

export function docToLines(doc: JSONContent): EditorLine[] {
  const lines: EditorLine[] = [];
  (doc.content ?? []).forEach((node, group) => {
    switch (node.type) {
      case "paragraph":
        lines.push(line("paragraph", 0, group, node));
        return;
      case "blockquote":
        for (const child of node.content ?? []) {
          lines.push(line("quote", 0, group, child));
        }
        return;
      case "bulletList":
      case "orderedList":
        listLines(node, 0, group, lines);
        return;
      case "codeBlock": {
        const text = (node.content ?? []).map((t) => t.text ?? "").join("");
        const lang = (node.attrs?.language as string | null) ?? undefined;
        for (const row of text.split("\n")) {
          lines.push({
            block: "code",
            depth: 0,
            group,
            ...(lang ? { lang } : {}),
            runs: row ? [{ text: row, marks: [] }] : [],
          });
        }
        return;
      }
    }
  });
  return lines;
}

function line(
  block: EditorLine["block"],
  depth: number,
  group: number,
  paragraph: JSONContent | undefined,
): EditorLine {
  return { block, depth, group, runs: runsOf(paragraph?.content) };
}

function listLines(
  list: JSONContent,
  depth: number,
  group: number,
  lines: EditorLine[],
) {
  const block = list.type === "orderedList" ? "ordered" : "bullet";
  for (const item of list.content ?? []) {
    const [first, ...nested] = item.content ?? [];
    lines.push(line(block, depth, group, first));
    for (const child of nested) listLines(child, depth + 1, group, lines);
  }
}

function runsOf(nodes: JSONContent[] = []): EditorRun[] {
  const runs: EditorRun[] = [];
  for (const node of nodes) {
    const marks = (node.marks ?? [])
      .map((m) => m.type)
      .filter((type): type is EditorMark => MARKS.includes(type));
    const href = node.marks?.find((m) => m.type === "link")?.attrs?.href as
      | string
      | undefined;
    const link = href ? { href } : {};
    if (node.type === "mention") {
      runs.push({
        mention: { ...(node.attrs as unknown as MentionRef) },
        marks,
      });
    } else if (node.type === "text" && node.text) {
      runs.push({ text: node.text, marks, ...link });
    }
  }
  return runs;
}

// Lines with each mention as the words it shows (@handle, #name): what
// Copy puts on the clipboard, where a token would read as noise. Pasted
// back, a handle with one owner becomes a mention again.
export function mentionsAsWords(lines: EditorLine[]): EditorLine[] {
  return lines.map((line) => ({
    ...line,
    runs: line.runs.map((run) =>
      "mention" in run
        ? { text: mentionText(run.mention), marks: run.marks }
        : run,
    ),
  }));
}

export function linesToDoc(lines: EditorLine[]): JSONContent {
  const content: JSONContent[] = [];
  let i = 0;
  while (i < lines.length) {
    const first = lines[i];
    let end = i + 1;
    if (first.block !== "paragraph") {
      const list = (l: EditorLine) =>
        l.block === "bullet" || l.block === "ordered";
      while (
        end < lines.length &&
        lines[end].group === first.group &&
        (lines[end].block === first.block || (list(first) && list(lines[end])))
      ) {
        end++;
      }
    }
    const together = lines.slice(i, end);
    switch (first.block) {
      case "paragraph":
        content.push(paragraph(first.runs));
        break;
      case "quote":
        content.push({
          type: "blockquote",
          content: together.map((l) => paragraph(l.runs)),
        });
        break;
      case "code": {
        const text = together
          .map((l) => l.runs.map((r) => ("text" in r ? r.text : "")).join(""))
          .join("\n");
        content.push({
          type: "codeBlock",
          attrs: { language: first.lang ?? null },
          content: text ? [{ type: "text", text }] : undefined,
        });
        break;
      }
      default:
        content.push(...lists(together));
    }
    i = end;
  }
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

function paragraph(runs: EditorRun[]): JSONContent {
  const content = runs.flatMap((run): JSONContent[] => {
    const href = "href" in run ? run.href : undefined;
    const marks = [
      ...run.marks.map((type) => ({ type })),
      ...(href ? [{ type: "link", attrs: { href } }] : []),
    ];
    const withMarks = marks.length > 0 ? { marks } : {};
    if ("mention" in run) {
      return [{ type: "mention", attrs: { ...run.mention }, ...withMarks }];
    }
    return run.text ? [{ type: "text", text: run.text, ...withMarks }] : [];
  });
  return content.length > 0
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

// The format reads four levels, each inside the one before.
const MAX_LIST_DEPTH = 3;

// List lines back into nested lists, as fromMarkdown does for the parser's
// rows: a deeper line opens a list inside the item before it. A line's
// level is held to one deeper than the line before, and the list's first
// line to 0, so Markdown reads back the levels written.
function lists(lines: EditorLine[]): JSONContent[] {
  const roots: JSONContent[] = [];
  const stack: { depth: number; list: JSONContent }[] = [];
  let before = -1;
  for (const line of lines) {
    const depth = Math.max(0, Math.min(line.depth, before + 1, MAX_LIST_DEPTH));
    before = depth;
    const l = { ...line, depth };
    const type = l.block === "ordered" ? "orderedList" : "bulletList";
    const item: JSONContent = {
      type: "listItem",
      content: [paragraph(l.runs)],
    };
    while (stack.length > 0 && stack[stack.length - 1].depth > l.depth) {
      stack.pop();
    }
    const top = stack[stack.length - 1];
    if (top && top.depth === l.depth) {
      if (top.list.type === type) {
        top.list.content?.push(item);
        continue;
      }
      stack.pop();
    }
    const list: JSONContent = { type, content: [item] };
    const parentItems = stack[stack.length - 1]?.list.content;
    if (parentItems && parentItems.length > 0) {
      parentItems[parentItems.length - 1].content?.push(list);
    } else {
      roots.push(list);
    }
    stack.push({ depth: l.depth, list });
  }
  return roots;
}
