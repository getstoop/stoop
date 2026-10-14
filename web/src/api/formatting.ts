// Selection-based formatting for the composer and editor: wrap or unwrap
// the selection in Markdown markers, toggle a line prefix ("> ", "- ",
// "1. ") on the selected lines, or fence the selection as a code block. Pure functions over (value,
// selection) so they're easy to test and share.

import { parseInline } from "./markdown";

export type Format =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "spoiler"
  | "quote"
  | "list"
  | "orderedList"
  | "codeblock";

export type Edit = { value: string; start: number; end: number };

type LinePrefix = "quote" | "list" | "orderedList";

const MARKER: Record<Exclude<Format, LinePrefix | "codeblock">, string> = {
  bold: "**",
  italic: "*",
  underline: "__",
  strike: "~~",
  code: "`",
  spoiler: "||",
};

// What each line-prefix format writes, and what it recognises when
// toggling off. Ordered lists renumber as they are written.
const PREFIX: Record<
  LinePrefix,
  { write: (n: number) => string; match: RegExp }
> = {
  quote: { write: () => "> ", match: /^>\s?/ },
  list: { write: () => "- ", match: /^[-*]\s+/ },
  orderedList: { write: (n) => `${n + 1}. `, match: /^\d{1,9}[.)]\s+/ },
};

export function applyFormat(
  value: string,
  start: number,
  end: number,
  format: Format,
): Edit {
  if (format === "quote" || format === "list" || format === "orderedList") {
    return togglePrefix(value, start, end, format);
  }
  if (format === "codeblock") return fence(value, start, end);
  const m = MARKER[format];
  const sel = value.slice(start, end);
  // Caret sitting right before the closing marker → step out past it, so
  // "**bold|**" + shortcut + typing continues after the bold.
  if (
    start === end &&
    value.slice(end, end + m.length) === m &&
    !(start >= m.length && value.slice(start - m.length, start) === m)
  ) {
    return { value, start: end + m.length, end: end + m.length };
  }
  // Markers already hug the selection → remove them.
  if (
    start >= m.length &&
    value.slice(start - m.length, start) === m &&
    value.slice(end, end + m.length) === m
  ) {
    return {
      value:
        value.slice(0, start - m.length) + sel + value.slice(end + m.length),
      start: start - m.length,
      end: end - m.length,
    };
  }
  // The selection includes its own markers → strip them.
  if (sel.length >= 2 * m.length && sel.startsWith(m) && sel.endsWith(m)) {
    const inner = sel.slice(m.length, sel.length - m.length);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    };
  }
  return {
    value: value.slice(0, start) + m + sel + m + value.slice(end),
    start: start + m.length,
    end: end + m.length,
  };
}

// Toggle a line prefix over every line the selection touches. Already
// prefixed throughout → remove it; otherwise add it, replacing whichever
// other line prefix was there so the buttons swap rather than stack.
function togglePrefix(
  value: string,
  start: number,
  end: number,
  format: LinePrefix,
): Edit {
  const ls = value.lastIndexOf("\n", start - 1) + 1;
  let le = value.indexOf("\n", end);
  if (le === -1) le = value.length;
  const lines = value.slice(ls, le).split("\n");
  const { write, match } = PREFIX[format];
  const on = lines.every((l) => match.test(l));
  const others = Object.entries(PREFIX)
    .filter(([k]) => k !== format)
    .map(([, v]) => v.match);
  const next = lines
    .map((l, i) => {
      if (on) return l.replace(match, "");
      let bare = l;
      for (const other of others) bare = bare.replace(other, "");
      return write(i) + bare;
    })
    .join("\n");
  return {
    value: value.slice(0, ls) + next + value.slice(le),
    start: ls,
    end: ls + next.length,
  };
}

function fence(value: string, start: number, end: number): Edit {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  const trail = after && !after.startsWith("\n") ? "\n" : "";
  const s = start + lead.length + 4; // past "```\n"
  return {
    value: `${before}${lead}\`\`\`\n${sel}\n\`\`\`${trail}${after}`,
    start: s,
    end: s + sel.length,
  };
}

// An address pasted over selected words links the words to it, with the
// caret after the link. Null when the paste is anything else, or the
// words can't be a link's (they hold an address, a bracket or a line
// break): the paste then replaces them as usual.
export function linkSelection(
  value: string,
  start: number,
  end: number,
  pasted: string,
): Edit | null {
  const words = value.slice(start, end);
  const address = pasted.trim();
  if (words.trim() === "" || words.includes("\n")) return null;
  if (!/^https?:\/\/\S+$/i.test(address)) return null;
  const link = `[${words}](${address})`;
  const parsed = parseInline(link);
  if (parsed.length !== 1 || parsed[0].type !== "link" || !parsed[0].label) {
    return null;
  }
  const caret = start + link.length;
  return {
    value: value.slice(0, start) + link + value.slice(end),
    start: caret,
    end: caret,
  };
}

// ⌘/Ctrl+B, I, U, E (code) and ⌘/Ctrl+Shift+X (strike).
export function shortcutFormat(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): Format | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return k === "x" ? "strike" : null;
  switch (k) {
    case "b":
      return "bold";
    case "i":
      return "italic";
    case "u":
      return "underline";
    case "e":
      return "code";
    default:
      return null;
  }
}

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export function shortcutHint(keys: string): string {
  return IS_MAC ? `⌘${keys}` : `Ctrl+${keys}`;
}
