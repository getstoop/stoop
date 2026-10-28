// What "No messages match …" names: the query's words without its
// channel filter, and the channel that filter named, if any, so the
// line can read "No messages match chapter 99 in #chapters." and offer
// the whole space. A name quoted for its spaces (in:"#front steps") is
// read to its first word; the chips never write one.
export function noMatchParts(query: string): { words: string; channel: string | null } {
  let channel: string | null = null;
  const words: string[] = [];
  for (const token of query.split(/\s+/)) {
    if (!token) continue;
    if (token.toLowerCase().startsWith("in:")) {
      channel = token.slice(3).replace(/^["#]+|"+$/g, "");
    } else {
      words.push(token);
    }
  }
  return { words: words.join(" "), channel: channel || null };
}
