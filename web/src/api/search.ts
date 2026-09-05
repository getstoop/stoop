import { Code, ConnectError } from "@connectrpc/connect";
import { errorText } from "./errors";

// Message search (docs/proposals/message-search.md). The server parses
// the query; this side only needs to know which words to highlight and
// how to word the errors the server sends back.

const FILTER_KEYS = new Set(["from", "in", "before", "after"]);

// The words in a query worth highlighting in a result: filters, negated
// words and OR are dropped; quoted phrases become their words. Matching
// is by word prefix on the client, which over-highlights a little
// rather than missing the prefixed last term.
export function highlightTerms(query: string): string[] {
  const out: string[] = [];
  for (const tok of query.split(/\s+/)) {
    if (!tok || tok.startsWith("-")) continue;
    const colon = tok.indexOf(":");
    if (colon > 0 && FILTER_KEYS.has(tok.slice(0, colon).toLowerCase())) {
      continue;
    }
    for (const word of tok.replace(/["*]/g, "").split(/[^\p{L}\p{N}_'-]+/u)) {
      if (word && word.toLowerCase() !== "or") out.push(word.toLowerCase());
    }
  }
  return out;
}

// A regex that finds any of the terms at the start of a word, or null
// when there is nothing to highlight.
export function highlightPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})[\\p{L}\\p{N}_]*`,
    "giu",
  );
}

// Whether the query already narrows to this channel.
export function inChannel(query: string, name: string): boolean {
  return query.split(/\s+/).some((t) => t.toLowerCase() === `in:#${name}`);
}

// The query with the channel filter added or removed.
export function toggleInChannel(query: string, name: string): string {
  const rest = query
    .split(/\s+/)
    .filter((t) => t && !t.toLowerCase().startsWith("in:"))
    .join(" ");
  return inChannel(query, name) ? rest : `in:#${name} ${rest}`.trim();
}

// What to tell the person when a search fails.
export function searchErrorText(err: unknown): string {
  if (err instanceof ConnectError) {
    if (err.code === Code.ResourceExhausted) {
      return "Too many searches. Try again in a minute.";
    }
    if (err.code === Code.DeadlineExceeded) {
      return "That search took too long. Add a channel or a word.";
    }
  }
  return errorText(err);
}
