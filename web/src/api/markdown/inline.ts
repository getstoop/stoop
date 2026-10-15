import { mentionTokenAt, tokensAsText } from "../mentions";
import type { Inline } from "./types";

// Inline syntax, left to right: mention tokens, escapes, `code`, bare http(s) links,
// [words](https://address), ***both***, then **bold**, __underline__,
// ~~strike~~, ||spoiler|| and *italic*. `_italic_` is deliberately absent
// so @user_names survive.

// "-" is escapable too, so a line may start with a literal dash
// without becoming a list.
const ESCAPABLE = /[\\`*_~>|#[\]()-]/;
const URL_AT = /^https?:\/\/[^\s<]+/i;
const URL_WHOLE = /^https?:\/\/[^\s<]+$/i;
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;

type Style = "bold" | "italic" | "underline" | "strike" | "spoiler";

// Longest first, so "**" wins over "*".
const DELIMS: [string, Style][] = [
  ["**", "bold"],
  ["__", "underline"],
  ["~~", "strike"],
  ["||", "spoiler"],
  ["*", "italic"],
];

export function parseInline(s: string): Inline[] {
  return new InlineParser(s).parse();
}

// A cursor over one line. Each match method either consumes a construct
// at the cursor and returns true, or leaves the cursor where it was;
// whatever none of them take is plain text.
class InlineParser {
  private readonly out: Inline[] = [];
  private text = "";
  private i = 0;

  constructor(private readonly s: string) {}

  parse(): Inline[] {
    while (this.i < this.s.length) {
      if (
        this.mention() ||
        this.escape() ||
        this.code() ||
        this.bareLink() ||
        this.labelledLink() ||
        this.boldItalic() ||
        this.delimited()
      ) {
        continue;
      }
      this.text += this.s[this.i++];
    }
    this.flush();
    return this.out;
  }

  private emit(node: Inline, end: number): true {
    this.flush();
    this.out.push(node);
    this.i = end;
    return true;
  }

  private flush() {
    if (this.text) this.out.push({ type: "text", text: this.text });
    this.text = "";
  }

  // A token is whole: its handle may hold "__", which isn't underline.
  private mention(): boolean {
    const { s, i } = this;
    if (s[i] !== "<") return false;
    const token = mentionTokenAt(s.slice(i));
    if (!token) return false;
    return this.emit(
      { type: "mention", mention: token.mention },
      i + token.length,
    );
  }

  private escape(): boolean {
    const { s, i } = this;
    if (s[i] !== "\\" || i + 1 >= s.length || !ESCAPABLE.test(s[i + 1])) {
      return false;
    }
    this.text += s[i + 1];
    this.i += 2;
    return true;
  }

  private code(): boolean {
    const { s, i } = this;
    if (s[i] !== "`") return false;
    const close = s.indexOf("`", i + 1);
    if (close <= i + 1) return false;
    return this.emit(
      { type: "code", text: tokensAsText(s.slice(i + 1, close)) },
      close + 1,
    );
  }

  private bareLink(): boolean {
    const { s, i } = this;
    if (s[i] !== "h" && s[i] !== "H") return false;
    const m = URL_AT.exec(s.slice(i));
    if (!m) return false;
    const href = trimUrl(m[0]);
    return this.emit({ type: "link", href }, i + href.length);
  }

  // "[words](https://address)". The words can't hold a link of their own,
  // so a label never shows one address over another.
  private labelledLink(): boolean {
    const { s, i } = this;
    if (s[i] !== "[") return false;
    let labelEnd = i + 1;
    while (labelEnd < s.length && s[labelEnd] !== "]") {
      if (s[labelEnd] === "[") return false;
      const escaped =
        s[labelEnd] === "\\" &&
        labelEnd + 1 < s.length &&
        ESCAPABLE.test(s[labelEnd + 1]);
      labelEnd += escaped ? 2 : 1;
    }
    if (s[labelEnd] !== "]" || s[labelEnd + 1] !== "(") return false;
    const words = s.slice(i + 1, labelEnd);
    if (words.trim() === "") return false;
    // The address ends at the ")" that isn't closing a "(" inside it.
    const hrefStart = labelEnd + 2;
    let hrefEnd = hrefStart;
    let depth = 0;
    while (hrefEnd < s.length) {
      if (s[hrefEnd] === "(") depth++;
      if (s[hrefEnd] === ")" && depth-- === 0) break;
      hrefEnd++;
    }
    if (hrefEnd >= s.length) return false;
    const href = s.slice(hrefStart, hrefEnd);
    if (!URL_WHOLE.test(href)) return false;
    // A link's words can't mention anyone: a token there reads as its handle.
    const label = parseInline(tokensAsText(words));
    if (holdsLink(label)) return false;
    return this.emit({ type: "link", href, label }, hrefEnd + 1);
  }

  // ***both*** is bold around italic.
  private boldItalic(): boolean {
    const { s, i } = this;
    if (!s.startsWith("***", i)) return false;
    const close = findCloser(s, "***", i + 3);
    if (close === -1) return false;
    const children = parseInline(s.slice(i + 3, close));
    return this.emit(
      { type: "bold", children: [{ type: "italic", children }] },
      close + 3,
    );
  }

  private delimited(): boolean {
    const { s, i } = this;
    for (const [d, type] of DELIMS) {
      if (!s.startsWith(d, i)) continue;
      const start = i + d.length;
      // The opener must be followed by something other than whitespace
      // (or, for "*", another "*" — that's an unclosed "**").
      if (start >= s.length || /\s/.test(s[start])) continue;
      if (d === "*" && s[start] === "*") continue;
      const close = findCloser(s, d, start + 1);
      if (close === -1) continue;
      // A spoiler can't mention anyone: a token there reads as its handle.
      const inner = s.slice(start, close);
      const children = parseInline(
        type === "spoiler" ? tokensAsText(inner) : inner,
      );
      return this.emit({ type, children }, close + d.length);
    }
    return false;
  }
}

function holdsLink(nodes: Inline[]): boolean {
  return nodes.some(
    (n) => n.type === "link" || ("children" in n && holdsLink(n.children)),
  );
}

// The first occurrence of d at or after `from` that follows a non-space.
// A lone "*" never closes on half of a "**" pair.
function findCloser(s: string, d: string, from: number): number {
  let j = s.indexOf(d, from);
  while (
    j !== -1 &&
    (/\s/.test(s[j - 1]) ||
      (d === "*" && (s[j - 1] === "*" || s[j + 1] === "*")))
  ) {
    j = s.indexOf(d, j + 1);
  }
  return j;
}

// Trailing punctuation belongs to the sentence, not the link, except a
// ")" that closes a "(" inside the URL.
function trimUrl(raw: string): string {
  let href = raw.replace(TRAILING_PUNCT, "");
  let rest = raw.slice(href.length);
  while (rest.startsWith(")") && count(href, "(") > count(href, ")")) {
    href += ")";
    rest = rest.slice(1);
  }
  return href;
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}
