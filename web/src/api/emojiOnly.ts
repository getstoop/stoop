// A message of nothing but emoji, up to 23 of them, shows them large.
const MAX_LARGE_EMOJI = 23;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const isEmoji = (g: string) =>
  /\p{Extended_Pictographic}/u.test(g) ||
  /^\p{Regional_Indicator}{2}$/u.test(g) ||
  /^[0-9#*]️?⃣$/u.test(g);

export function emojiOnly(content: string): boolean {
  let count = 0;
  for (const { segment } of graphemes.segment(content)) {
    if (/^\s+$/u.test(segment)) continue;
    if (!isEmoji(segment) || ++count > MAX_LARGE_EMOJI) return false;
  }
  return count > 0;
}
