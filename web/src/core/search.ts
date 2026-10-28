// Message search (docs/architecture/messaging.md → Search), the part
// both apps share. The server parses the query; this side only needs to
// know which words to highlight, how to add or drop the channel filter,
// and how to word the refusals the server's guards send back.

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

// The query's tokens as the server reads them (internal/chat
// search_query.go, tokenizeSearch): split on whitespace, a "quoted
// phrase" staying one token with its quotes, also after a key: prefix.
// So `"sign in:" error` carries no filter, and `in:"front steps"` is one.
export function queryTokens(query: string): string[] {
  const out: string[] = [];
  let token = "";
  let quoted = false;
  for (const ch of query) {
    if (ch === '"') {
      quoted = !quoted;
      token += ch;
    } else if (!quoted && /\s/.test(ch)) {
      if (token) out.push(token);
      token = "";
    } else {
      token += ch;
    }
  }
  if (token) out.push(token);
  return out;
}

// Whether the query already narrows to this channel.
export function inChannel(query: string, name: string): boolean {
  // Both sides lowercased: channel names are only length-checked by the
  // server, so a #General exists, and comparing a lowercased token to a
  // raw name never matched — its chip could not be turned off again.
  const want = name.toLowerCase();
  return queryTokens(query).some((t) => channelOf(t) === want);
}

// Whether the query narrows to any channel.
export function hasChannelFilter(query: string): boolean {
  return queryTokens(query).some(isChannelFilter);
}

// The query with every channel filter removed.
export function withoutChannelFilter(query: string): string {
  return queryTokens(query)
    .filter((t) => !isChannelFilter(t))
    .join(" ");
}

const isChannelFilter = (token: string) =>
  token.toLowerCase().startsWith("in:");

// The channel a filter token names, read as the server reads it: the
// quotes and the # dropped, so `in:general` and `in:"#General"` both
// name general. Null for any other token.
function channelOf(token: string): string | null {
  if (!isChannelFilter(token)) return null;
  return token.slice(3).replace(/"/g, "").replace(/^#/, "").toLowerCase();
}

// The query with this channel's filter added or removed; a filter
// naming another channel is replaced.
export function toggleInChannel(query: string, name: string): string {
  const rest = withoutChannelFilter(query);
  return inChannel(query, name) ? rest : `in:#${name} ${rest}`.trim();
}

// What to tell the person when the server's guards refuse a search: the
// rate limit (ResourceExhausted) and the statement timeout
// (DeadlineExceeded). Each app reads the Connect code itself, since core
// may not import the Connect runtime.
export const SEARCH_REFUSALS = {
  tooMany: "Too many searches. Try again in a minute.",
  tooLong: "That search took too long. Add a channel or a word.",
} as const;
