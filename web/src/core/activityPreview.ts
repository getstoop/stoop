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
// A poll's preview ("Poll: " or "Poll closed: " and its question, as the
// server words it) and a delivered reminder's ("Reminder: " and its text)
// are plain text all through: an @name in either names nobody, so
// nothing in it is highlighted. (A message that starts with those words
// goes unhighlighted too; the item does not say which it is.)
export function splitPreview(preview: string, handle: string): PreviewPart[] {
  if (POLL_PREVIEW.test(preview)) return [{ text: preview, mention: false }];
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

const POLL_PREVIEW = /^(?:Poll(?: closed)?|Reminder): /;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
