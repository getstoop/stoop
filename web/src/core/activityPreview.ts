// The activity preview, split so the row can highlight the handle the
// item is about: the reader's own, or @channel / @here when the message
// named everyone. The server hands the preview as plain text, so this is
// a word match, not Markdown.

export interface PreviewPart {
  text: string;
  mention: boolean;
}

// Splits a preview into runs of plain text and highlighted mentions.
// `handle` is the reader's username without the @. A handle is
// [a-z0-9_] (internal/auth usernameRE), so a match ends at anything else
// and "@ada" is not found in "@adam", while "@ada." is a mention.
export function splitPreview(preview: string, handle: string): PreviewPart[] {
  const names = ["channel", "here"];
  if (handle) names.unshift(escapeRegExp(handle));
  const re = new RegExp(`@(?:${names.join("|")})(?![a-z0-9_])`, "gi");
  const parts: PreviewPart[] = [];
  let last = 0;
  for (const m of preview.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last)
      parts.push({ text: preview.slice(last, at), mention: false });
    parts.push({ text: m[0], mention: true });
    last = at + m[0].length;
  }
  if (last < preview.length)
    parts.push({ text: preview.slice(last), mention: false });
  return parts;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
