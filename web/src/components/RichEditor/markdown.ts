import { type Inline, type ListItem, parseMarkdown } from "../../api/markdown";
import { type MentionRef, mentionToken } from "../../api/mentions";

// The rich editor's document and our Markdown subset, both ways. The draft
// is the document; Markdown is what it sends and what it loads to edit.

// The editor document's JSON form (ProseMirror's Node.toJSON).
export interface JSONContent {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: MarkJSON[];
  content?: JSONContent[];
}

type MarkJSON = { type: string; attrs?: Record<string, unknown> };

// Outermost first, so the Markdown nests the same way every time.
const MARK_ORDER = [
  "link",
  "spoiler",
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
];

const DELIM: Record<string, string> = {
  bold: "**",
  italic: "*",
  underline: "__",
  strike: "~~",
  spoiler: "||",
  code: "`",
};

export function toMarkdown(doc: JSONContent): string {
  const lines: string[] = [];
  for (const node of doc.content ?? []) block(node, lines);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function block(node: JSONContent, lines: string[]) {
  switch (node.type) {
    case "paragraph":
      lines.push(escapeLineStart(inline(node.content)));
      return;
    case "blockquote":
      for (const child of node.content ?? []) {
        const text = inline(child.content);
        lines.push(text ? `> ${text}` : ">");
      }
      return;
    case "bulletList":
    case "orderedList":
      list(node, 0, lines);
      return;
    case "codeBlock": {
      const text = (node.content ?? []).map((t) => t.text ?? "").join("");
      const lang = (node.attrs?.language as string | null) ?? "";
      lines.push(`\`\`\`${lang}`, ...text.split("\n"), "```");
      return;
    }
  }
}

function list(node: JSONContent, depth: number, lines: string[]) {
  const ordered = node.type === "orderedList";
  const indent = "  ".repeat(Math.min(depth, 3));
  let n = 1;
  for (const item of node.content ?? []) {
    const [first, ...rest] = item.content ?? [];
    const marker = ordered ? `${n++}. ` : "- ";
    lines.push(indent + marker + inline(first?.content));
    for (const child of rest) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        list(child, depth + 1, lines);
      } else {
        lines.push(`${indent}  ${inline(child.content)}`);
      }
    }
  }
}

// A paragraph that starts like a block marker would read back as one. A
// list marker counts after up to six spaces, as the reader allows.
const BULLET_START = /^( {0,6})([-*])(?=\s)/;
const NUMBER_START = /^( {0,6}\d{1,9})([.)])(?=\s)/;

function escapeLineStart(line: string): string {
  if (/^(>|```)/.test(line)) return `\\${line}`;
  return line.replace(BULLET_START, "$1\\$2").replace(NUMBER_START, "$1\\$2");
}

function inline(nodes: JSONContent[] = []): string {
  let out = "";
  const open: { mark: MarkJSON; bare: boolean }[] = [];
  const closeFrom = (keep: number) => {
    if (open.length <= keep) return;
    // Closers go before trailing whitespace: "**a **" doesn't close.
    const ws = /\s*$/.exec(out)?.[0] ?? "";
    out = out.slice(0, out.length - ws.length);
    for (let i = open.length - 1; i >= keep; i--) out += closer(open[i]);
    out += ws;
    open.length = keep;
  };
  for (const node of nodes.flatMap(splitCode)) {
    if (node.type !== "text" && node.type !== "mention") continue;
    const marks = sortMarks(node.marks ?? []);
    let keep = 0;
    while (
      keep < open.length &&
      keep < marks.length &&
      sameMark(open[keep].mark, marks[keep])
    ) {
      keep++;
    }
    closeFrom(keep);
    const mention =
      node.type === "mention" ? (node.attrs as unknown as MentionRef) : null;
    let text = mention ? `@${mention.handle}` : (node.text ?? "");
    if (marks.length > keep) {
      // Openers go after leading whitespace: "** a**" doesn't open.
      const ws = /^\s*/.exec(text)?.[0] ?? "";
      out += ws;
      text = text.slice(ws.length);
      if (!text) continue;
      for (const mark of marks.slice(keep)) {
        const bare = mark.type === "link" && node.text === mark.attrs?.href;
        out += bare ? "" : opener(mark);
        open.push({ mark, bare });
      }
    }
    const literal =
      marks.some((m) => m.type === "code") || open.some((o) => o.bare);
    const inWords = open.some((o) => o.mark.type === "link" && !o.bare);
    // In code a mention is the words it reads as.
    if (mention && !literal) out += mentionToken(mention);
    else out += literal ? text : escapeMarkup(text, inWords);
  }
  closeFrom(0);
  return out;
}

// A code span can't hold a backtick, nor a bracket in link words: those
// go out as escaped text beside the code.
function splitCode(node: JSONContent): JSONContent[] {
  const marks = node.marks ?? [];
  if (!node.text || !marks.some((m) => m.type === "code")) return [node];
  const inWords = marks.some(
    (m) => m.type === "link" && m.attrs?.href !== node.text,
  );
  const plain = marks.filter((m) => m.type !== "code");
  return node.text
    .split(inWords ? /([`[\]]+)/ : /(`+)/)
    .map((text, i) => ({ ...node, text, marks: i % 2 ? plain : marks }))
    .filter((piece) => piece.text);
}

// An address the reader takes back whole: http(s) with no space or "<",
// and every ")" closing a "(" before it.
export function readableAddress(href: string): boolean {
  if (!/^https?:\/\/[^\s<]+$/i.test(href)) return false;
  let depth = 0;
  for (const ch of href) {
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

function opener(mark: MarkJSON): string {
  return mark.type === "link" ? "[" : (DELIM[mark.type] ?? "");
}

function closer({ mark, bare }: { mark: MarkJSON; bare: boolean }): string {
  if (mark.type !== "link") return DELIM[mark.type] ?? "";
  return bare ? "" : `](${mark.attrs?.href})`;
}

function sortMarks(marks: MarkJSON[]): MarkJSON[] {
  return marks
    .filter((m) => MARK_ORDER.includes(m.type))
    .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

function sameMark(a: MarkJSON, b: MarkJSON) {
  return a.type === b.type && a.attrs?.href === b.attrs?.href;
}

// Characters the parser would read as markup. A single "_" stays, so
// @user_names survive; only "__" would underline. A bare address is left
// alone: the parser reads it whole, so a backslash would land in it.
const BARE_URL = /https?:\/\/[^\s<>]+/gi;

function escapeMarkup(text: string, inWords: boolean): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(BARE_URL)) {
    out += escapeRun(text.slice(last, m.index), inWords) + m[0];
    last = m.index + m[0].length;
  }
  return out + escapeRun(text.slice(last), inWords);
}

// In link words a "]" would end them early.
function escapeRun(text: string, inWords: boolean): string {
  const markup = inWords ? /[\\`*~|[\]]|__/g : /[\\`*~|[]|__/g;
  return text.replace(markup, (m) => (m === "__" ? "\\_\\_" : `\\${m}`));
}

export function fromMarkdown(md: string): JSONContent {
  const content: JSONContent[] = [];
  for (const b of parseMarkdown(md)) {
    switch (b.type) {
      case "lines":
        for (const line of b.lines) content.push(paragraph(line));
        break;
      case "quote":
        content.push({ type: "blockquote", content: b.lines.map(paragraph) });
        break;
      case "list":
        content.push(...lists(b.items));
        break;
      case "codeblock":
        content.push({
          type: "codeBlock",
          attrs: { language: b.lang || null },
          content: b.text ? [{ type: "text", text: b.text }] : undefined,
        });
        break;
    }
  }
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

function paragraph(line: Inline[]): JSONContent {
  const content = inlineJSON(line, []);
  return content.length > 0
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

function inlineJSON(nodes: Inline[], marks: MarkJSON[]): JSONContent[] {
  const out: JSONContent[] = [];
  const text = (t: string, m: MarkJSON[]) => {
    if (t)
      out.push(
        m.length
          ? { type: "text", text: t, marks: m }
          : { type: "text", text: t },
      );
  };
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        text(n.text, marks);
        break;
      case "code":
        text(n.text, [...marks, { type: "code" }]);
        break;
      case "mention":
        out.push(
          marks.length
            ? { type: "mention", attrs: { ...n.mention }, marks }
            : { type: "mention", attrs: { ...n.mention } },
        );
        break;
      case "link": {
        const link = { type: "link", attrs: { href: n.href } };
        if (n.label) out.push(...inlineJSON(n.label, [...marks, link]));
        // A bare address stays text; the editor styles it as a link.
        else text(n.href, marks);
        break;
      }
      default:
        out.push(...inlineJSON(n.children, [...marks, { type: n.type }]));
    }
  }
  return out;
}

// Flat rows with depths back into nested lists: a deeper row opens a list
// inside the item before it.
function lists(items: ListItem[]): JSONContent[] {
  const roots: JSONContent[] = [];
  const stack: { depth: number; list: JSONContent }[] = [];
  for (const it of items) {
    const type = it.ordered ? "orderedList" : "bulletList";
    const item: JSONContent = {
      type: "listItem",
      content: [paragraph(it.content)],
    };
    while (stack.length > 0 && stack[stack.length - 1].depth > it.depth) {
      stack.pop();
    }
    const top = stack[stack.length - 1];
    if (top && top.depth === it.depth) {
      if (top.list.type === type) {
        top.list.content?.push(item);
        continue;
      }
      stack.pop();
    }
    const list: JSONContent = { type, content: [item] };
    const parent = stack[stack.length - 1];
    const parentItems = parent?.list.content;
    if (parentItems && parentItems.length > 0) {
      parentItems[parentItems.length - 1].content?.push(list);
    } else {
      roots.push(list);
    }
    stack.push({ depth: it.depth, list });
  }
  return roots;
}
