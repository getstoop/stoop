// The message format: a small Discord-style Markdown subset, parsed into a
// tree the renderer turns into React nodes (never HTML strings). Blocks:
// fenced code, "> " quotes, "- "/"1. " lists, plain lines. Inline:
// **bold**, *italic*, __underline__, ~~strike~~, ||spoiler||, `code`,
// bare http(s) links. `_italic_` is deliberately absent so @user_names
// survive; escapes work with `\`.
//
// The parser keeps the markers themselves (StyledMarker) so the composer's
// live-styling overlay can dim them while they are typed; parseInline and
// parseMarkdown are projections that drop them, for MessageBody and the
// plain-text previews.

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; href: string }
  | {
      type: "bold" | "italic" | "underline" | "strike" | "spoiler";
      children: Inline[];
    };

// One list row: whether its marker was a number, its nesting depth (two
// spaces a level, capped), and the content after the marker. Kept flat —
// the renderer builds the tree. Ordered-ness rides on the row, not the
// block, because a numbered item's children are usually bullets.
export interface ListItem {
  ordered: boolean;
  depth: number;
  content: Inline[];
}

export type Block =
  | { type: "lines"; lines: Inline[][] }
  | { type: "quote"; lines: Inline[][] }
  | { type: "list"; items: ListItem[] }
  | { type: "codeblock"; text: string; lang: string };

// The marker-preserving inline tree. "code" is a backtick pair plus the
// literal run between them, "link" is a bare URL, and each style node is
// its open and close marker plus the styled content in between.
export type StyledInline =
  | { type: "text"; text: string }
  | { type: "code"; open: StyledMarker; text: string; close: StyledMarker }
  | { type: "link"; href: string }
  | {
      type: "bold" | "italic" | "underline" | "strike" | "spoiler";
      open: StyledMarker;
      children: StyledInline[];
      close: StyledMarker;
    };

// A quote line: its ">" marker plus the styled content after it.
export interface StyledQuoteLine {
  open: StyledMarker;
  line: StyledInline[];
}

// A list row with its marker ("- ", "  1. ") kept verbatim, indent and all.
export interface StyledListItem {
  open: StyledMarker;
  ordered: boolean;
  depth: number;
  content: StyledInline[];
}

export type StyledBlock =
  | { type: "lines"; lines: StyledInline[][] }
  | { type: "quote"; lines: StyledQuoteLine[] }
  | { type: "list"; items: StyledListItem[] }
  | {
      type: "codeblock";
      // The fence lines verbatim (e.g. "```js") plus the language for the
      // projection. body is the content between the fences, one source
      // line per entry (text is body.join("\n")); close is "" when the
      // fence is still open. sameLine marks a fence whose whole body is
      // on the opening line.
      open: StyledMarker;
      lang: string;
      sameLine: boolean;
      text: string;
      body: string[];
      close: StyledMarker;
    };

// A marker with the exact characters it occupies in the source, so the
// overlay can emit them verbatim.
export interface StyledMarker {
  text: string;
}

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

export function parseMarkdown(content: string): Block[] {
  return parseStyledMarkdown(content).map((b): Block => {
    if (b.type === "lines") {
      return { type: "lines", lines: b.lines.map(inlineProject) };
    }
    if (b.type === "quote") {
      return {
        type: "quote",
        lines: b.lines.map((q) => inlineProject(q.line)),
      };
    }
    if (b.type === "list") {
      return {
        type: "list",
        items: b.items.map((it) => ({
          ordered: it.ordered,
          depth: it.depth,
          content: inlineProject(it.content),
        })),
      };
    }
    return { type: "codeblock", text: b.text, lang: b.lang };
  });
}

// Marker-preserving parse, one source string in, exact slice out: the
// concatenation of every node's text is the input unchanged.
export function parseStyledMarkdown(content: string): StyledBlock[] {
  const lines = content.split("\n");
  const blocks: StyledBlock[] = [];
  const pushPlainLine = (line: StyledInline[]) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "lines") last.lines.push(line);
    else blocks.push({ type: "lines", lines: [line] });
  };
  const pushQuoteLine = (q: StyledQuoteLine) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "quote") last.lines.push(q);
    else blocks.push({ type: "quote", lines: [q] });
  };
  // Every consecutive list row joins one block, bullets and numbers alike;
  // the renderer decides where one <ul>/<ol> ends and the next begins, so a
  // numbered item can have bulleted children.
  const pushListItem = (item: StyledListItem) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "list") last.items.push(item);
    else blocks.push({ type: "list", items: [item] });
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const one = line.match(FENCE_ONE_LINE);
    if (one) {
      // Split the line into its opening fence, the content, and the closing
      // fence so the overlay renders it exactly once.
      const openText = line.slice(0, line.indexOf("```") + 3);
      const closeText = line.slice(openText.length + one[1].length);
      blocks.push({
        type: "codeblock",
        open: { text: openText },
        lang: "",
        sameLine: true,
        text: one[1],
        body: [one[1]],
        close: { text: closeText },
      });
      i++;
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !FENCE_CLOSE.test(lines[j])) {
        body.push(lines[j]);
        j++;
      }
      blocks.push({
        type: "codeblock",
        open: { text: line },
        lang: open[1],
        sameLine: false,
        text: body.join("\n"),
        body,
        close: { text: j < lines.length ? lines[j] : "" },
      });
      i = j + 1;
      continue;
    }
    const list = line.match(LIST);
    if (list) {
      const [, indent, bullet, rest] = list;
      pushListItem({
        // The indent and the bullet plus the space after it: the whole
        // prefix, so the overlay dims exactly what the source shows.
        open: { text: line.slice(0, line.length - rest.length) },
        ordered: /\d/.test(bullet[0]),
        depth: Math.min(MAX_LIST_DEPTH, Math.floor(indent.length / 2)),
        content: parseStyledInline(rest),
      });
      i++;
      continue;
    }
    const quote = line.match(QUOTE);
    if (quote) {
      // The ">" plus any space it consumed is the quote's marker, so the
      // overlay can dim the whole prefix.
      const prefix = line.slice(0, line.length - quote[1].length);
      pushQuoteLine({
        open: { text: prefix },
        line: parseStyledInline(quote[1]),
      });
    } else {
      pushPlainLine(parseStyledInline(line));
    }
    i++;
  }
  return blocks;
}

// "-" is escapable too, so a line may start with a literal dash
// without becoming a list.
const ESCAPABLE = /[\\`*_~>|#[\]()-]/;
const URL_AT = /^https?:\/\/[^\s<]+/i;
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;

// Delimiters longest first so "**" wins over "*".
const DELIMS: [
  string,
  "bold" | "italic" | "underline" | "strike" | "spoiler",
][] = [
  ["**", "bold"],
  ["__", "underline"],
  ["~~", "strike"],
  ["||", "spoiler"],
  ["*", "italic"],
];

// Marker-preserving inline parse: every character of `s` survives, either
// as text or inside a marker.
export function parseStyledInline(s: string): StyledInline[] {
  const out: StyledInline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      text += ch + s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i + 1) {
        flush();
        out.push({
          type: "code",
          open: { text: "`" },
          text: s.slice(i + 1, j),
          close: { text: "`" },
        });
        i = j + 1;
        continue;
      }
    }
    if (ch === "h" || ch === "H") {
      const m = URL_AT.exec(s.slice(i));
      if (m) {
        const href = m[0].replace(TRAILING_PUNCT, "");
        flush();
        out.push({ type: "link", href });
        i += href.length;
        continue;
      }
    }
    // ***both*** is bold around italic.
    if (s.startsWith("***", i)) {
      const j = findCloser(s, "***", i + 3);
      if (j !== -1) {
        flush();
        out.push({
          type: "bold",
          open: { text: "***" },
          children: [
            {
              type: "italic",
              open: { text: "" },
              children: parseStyledInline(s.slice(i + 3, j)),
              close: { text: "" },
            },
          ],
          close: { text: "***" },
        });
        i = j + 3;
        continue;
      }
    }
    const span = matchDelimited(s, i);
    if (span) {
      flush();
      out.push({
        type: span.type,
        open: { text: span.delim },
        children: parseStyledInline(span.inner),
        close: { text: span.delim },
      });
      i = span.end;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

// The inline tree with its markers dropped, for rendering and previews.
export function parseInline(s: string): Inline[] {
  return inlineProject(parseStyledInline(s));
}

function inlineProject(nodes: StyledInline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push({
          type: "text",
          text: n.text.replace(/\\([\\`*_~>|#[\]()-])/g, "$1"),
        });
        break;
      case "code":
        out.push({ type: "code", text: n.text });
        break;
      case "link":
        out.push({ type: "link", href: n.href });
        break;
      default:
        out.push({ type: n.type, children: inlineProject(n.children) });
    }
  }
  return out;
}

function matchDelimited(s: string, i: number) {
  for (const [d, type] of DELIMS) {
    if (!s.startsWith(d, i)) continue;
    const start = i + d.length;
    // The opener must be followed by something other than whitespace (or,
    // for "*", another "*" — that's an unclosed "**").
    if (start >= s.length || /\s/.test(s[start])) continue;
    if (d === "*" && s[start] === "*") continue;
    const j = findCloser(s, d, start + 1);
    if (j === -1) continue;
    return {
      type,
      delim: d,
      inner: s.slice(start, j),
      end: j + d.length,
    };
  }
  return null;
}

// The first occurrence of d at or after `from` that follows a non-space.
function findCloser(s: string, d: string, from: number): number {
  let j = s.indexOf(d, from);
  while (j !== -1 && /\s/.test(s[j - 1])) j = s.indexOf(d, j + 1);
  return j;
}

// The message with its markup removed, for one-line previews (reply bar,
// activity previews). Mirrors plainText on the server.
export function plainText(content: string): string {
  return parseMarkdown(content)
    .map((b) => {
      if (b.type === "codeblock") return b.text;
      // A list reads as its items; the bullets themselves are markup.
      if (b.type === "list") {
        return b.items.map((it) => inlineText(it.content)).join("\n");
      }
      return b.lines.map(inlineText).join("\n");
    })
    .join("\n")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.text;
        case "link":
          return n.href;
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}
