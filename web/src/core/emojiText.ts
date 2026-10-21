// Emoji in message text: told apart so they can be drawn a little larger
// than the words around them.

const MAX_LARGE_EMOJI = 23;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const isEmoji = (g: string) =>
  /\p{Extended_Pictographic}/u.test(g) ||
  /^\p{Regional_Indicator}{2}$/u.test(g) ||
  /^[0-9#*]️?⃣$/u.test(g);

// A message of nothing but emoji, up to 23 of them, shows them large.
export function emojiOnly(content: string): boolean {
  let count = 0;
  for (const { segment } of graphemes.segment(content)) {
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
  for (const { segment } of graphemes.segment(s)) {
    const emoji = isEmoji(segment);
    const last = out[out.length - 1];
    if (last && last.emoji === emoji) last.text += segment;
    else out.push({ text: segment, emoji });
  }
  return out;
}
