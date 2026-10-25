// Emoji in message text: told apart so they can be drawn a little larger
// than the words around them.

const MAX_LARGE_EMOJI = 23;

// Hermes, the phone app's engine, has no Intl.Segmenter.
const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

// Where there is no segmenter, the clusters that matter here: an emoji
// with its modifiers, tags and joined parts, a flag's pair of regional
// indicators, or one character with its combining marks (a keycap's
// among them).
const CLUSTER =
  /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}])*)*|[\s\S]\p{M}*/gu;

export function clusters(s: string): string[] {
  return s.match(CLUSTER) ?? [];
}

// One at a time, so a caller can stop at the first that settles it.
function* graphemes(s: string): Generator<string> {
  if (segmenter) {
    for (const { segment } of segmenter.segment(s)) yield segment;
  } else {
    for (const match of s.matchAll(CLUSTER)) yield match[0];
  }
}

const isEmoji = (g: string) =>
  /\p{Extended_Pictographic}/u.test(g) ||
  /^\p{Regional_Indicator}{2}$/u.test(g) ||
  /^[0-9#*]️?⃣$/u.test(g);

// A message of nothing but emoji, up to 23 of them, shows them large.
export function emojiOnly(content: string): boolean {
  let count = 0;
  for (const segment of graphemes(content)) {
    if (/^\s+$/u.test(segment)) continue;
    if (!isEmoji(segment) || ++count > MAX_LARGE_EMOJI) return false;
  }
  return count > 0;
}

const MAYBE_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

// Text split into runs of words and runs of emoji.
export function splitEmoji(s: string): { text: string; emoji: boolean }[] {
  if (!MAYBE_EMOJI.test(s)) return [{ text: s, emoji: false }];
  const out: { text: string; emoji: boolean }[] = [];
  for (const segment of graphemes(s)) {
    const emoji = isEmoji(segment);
    const last = out[out.length - 1];
    if (last && last.emoji === emoji) last.text += segment;
    else out.push({ text: segment, emoji });
  }
  return out;
}
