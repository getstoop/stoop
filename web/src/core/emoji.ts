// The reaction picker's emoji set, shared with the phone: the full
// Unicode list (generated into emojiData.ts, grouped in CLDR order), the
// curated row of the usual suspects, hand-written search keywords for
// the common ones, and the search over all of it. What was used recently
// is each client's own store (web/src/api/emoji.ts, mobile/src/api/emoji.ts)
// over the pure list rules here. Custom emoji per space will arrive with
// file uploads and fit the same shape.

import { EMOJI_GROUPS } from "./emojiData";
import { aliasesFor } from "./shortcodes";

// The curated row of the usual reactions, in the order the picker shows
// them under "Common"; the phone's message menu offers the first few as
// quick reactions.
export const COMMON_EMOJI = [
  "👍",
  "👎",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🎉",
  "🔥",
  "👀",
  "🙏",
  "💯",
  "✅",
  "❌",
  "😍",
  "🤔",
  "😅",
  "🙌",
  "👏",
  "🚀",
  "💀",
  "🫡",
  "😭",
  "🤣",
  "🥳",
];

export type EmojiEntry = { emoji: string; name: string; keywords?: string };

// Extra search terms for emoji whose Unicode name isn't what people type.
const KEYWORDS = new Map<string, string>([
  ["👍", "yes ok like +1"],
  ["👎", "no dislike -1"],
  ["❤️", "love"],
  ["🧡", "love"],
  ["💛", "love"],
  ["💚", "love"],
  ["💙", "love"],
  ["💜", "love"],
  ["💔", "sad"],
  ["😀", "smile happy"],
  ["😃", "smile"],
  ["😄", "smile"],
  ["😁", "grin smile"],
  ["😆", "laugh"],
  ["😅", "phew nervous"],
  ["🤣", "rofl lol"],
  ["😂", "lol laugh cry"],
  ["🙃", "silly"],
  ["😉", "wink"],
  ["😊", "blush"],
  ["😇", "angel innocent"],
  ["🥰", "love"],
  ["😍", "love"],
  ["🤩", "wow eyes"],
  ["😘", "kiss"],
  ["😋", "yum"],
  ["😜", "crazy"],
  ["🤪", "crazy"],
  ["🤑", "rich"],
  ["🤗", "hug"],
  ["🤭", "oops giggle"],
  ["🤫", "quiet secret"],
  ["🤔", "hmm"],
  ["🫡", "salute yes sir"],
  ["🤐", "secret"],
  ["😐", "meh"],
  ["😶", "silent"],
  ["🫠", "hot embarrassed"],
  ["😏", "smirk"],
  ["😒", "meh"],
  ["🙄", "eyeroll"],
  ["😬", "awkward"],
  ["🤥", "pinocchio"],
  ["😔", "sad"],
  ["😪", "tired"],
  ["😴", "zzz"],
  ["😷", "sick"],
  ["🤒", "sick"],
  ["🤕", "hurt"],
  ["🤢", "sick gross"],
  ["🤮", "sick gross"],
  ["🥵", "heat"],
  ["🥶", "freezing"],
  ["🥴", "drunk"],
  ["😵", "dead dizzy"],
  ["🤯", "mind blown"],
  ["🥳", "party celebrate"],
  ["😎", "cool"],
  ["🤓", "glasses"],
  ["🧐", "curious"],
  ["🙁", "sad"],
  ["😮", "wow surprised"],
  ["😯", "surprised"],
  ["😲", "shocked"],
  ["😳", "embarrassed"],
  ["🥺", "puppy eyes please"],
  ["😢", "sad tear"],
  ["😭", "sob sad"],
  ["😱", "scream"],
  ["😤", "angry huff"],
  ["😡", "angry mad"],
  ["😠", "mad"],
  ["🤬", "swearing"],
  ["💀", "dead"],
  ["💩", "poop"],
  ["👻", "boo"],
  ["🎃", "pumpkin halloween"],
  ["👋", "hi bye hello"],
  ["✋", "stop high five"],
  ["👌", "okay"],
  ["🤌", "italian"],
  ["✌️", "peace"],
  ["🤞", "luck"],
  ["🤘", "rock"],
  ["🤙", "shaka"],
  ["✊", "power"],
  ["👊", "punch bump"],
  ["👏", "clap applause bravo"],
  ["🙌", "hooray praise"],
  ["🫶", "love"],
  ["🤝", "deal agree"],
  ["🙏", "please thanks pray"],
  ["💪", "strong muscle"],
  ["👀", "look watching"],
  ["🧠", "smart"],
  ["🐶", "puppy"],
  ["🐱", "kitten"],
  ["🐰", "bunny"],
  ["🐝", "bee"],
  ["🐛", "caterpillar"],
  ["🐌", "slow"],
  ["🐢", "slow"],
  ["🐍", "python"],
  ["🦖", "dinosaur"],
  ["🦀", "rust"],
  ["🐐", "greatest"],
  ["🍀", "luck"],
  ["🌹", "flower"],
  ["🌻", "flower"],
  ["🌸", "flower"],
  ["☀️", "sunny"],
  ["🌙", "night"],
  ["🌟", "sparkle"],
  ["✨", "magic new"],
  ["⚡", "lightning zap fast"],
  ["🔥", "lit hot flame"],
  ["💥", "boom explosion"],
  ["❄️", "cold winter"],
  ["☔", "rain"],
  ["🌊", "ocean surf"],
  ["🌶️", "spicy"],
  ["🍞", "toast"],
  ["🍔", "burger"],
  ["🍜", "ramen noodles"],
  ["🍿", "movie watching"],
  ["🍩", "donut"],
  ["☕", "coffee tea"],
  ["🍺", "beer"],
  ["🍻", "cheers"],
  ["🥂", "cheers champagne"],
  ["⚽", "football"],
  ["🏆", "win winner champion"],
  ["🥇", "gold first"],
  ["🎯", "target dart"],
  ["🎮", "controller gaming"],
  ["🎲", "dice"],
  ["🎵", "music"],
  ["🎤", "sing karaoke"],
  ["🎧", "music"],
  ["🎬", "movie film"],
  ["📷", "photo"],
  ["🚗", "car"],
  ["🚲", "bike"],
  ["✈️", "plane travel"],
  ["🚀", "launch ship space"],
  ["🛸", "ufo"],
  ["🏠", "home"],
  ["🏖️", "vacation"],
  ["⌚", "time"],
  ["💻", "computer"],
  ["💡", "idea"],
  ["🔦", "torch"],
  ["📚", "read study"],
  ["📝", "note write"],
  ["📌", "pin"],
  ["🔒", "lock secure"],
  ["🔨", "build tool"],
  ["🔧", "fix tool"],
  ["⚙️", "settings"],
  ["🧪", "science experiment"],
  ["🔬", "science"],
  ["💊", "medicine"],
  ["🩹", "bandaid fix"],
  ["💰", "cash rich"],
  ["💸", "expensive"],
  ["🎁", "present"],
  ["🎈", "party"],
  ["🎉", "tada celebrate hooray"],
  ["🎊", "celebrate"],
  ["🏳️‍🌈", "pride"],
  ["🏁", "finish done race"],
  ["💯", "100 perfect"],
  ["✅", "done yes tick"],
  ["☑️", "done tick"],
  ["✔️", "done yes tick"],
  ["❌", "no wrong x"],
  ["❓", "what"],
  ["❗", "important"],
  ["⚠️", "caution"],
  ["🚫", "no forbidden"],
  ["♻️", "recycle"],
  ["⏰", "time late"],
  ["⏳", "waiting time"],
  ["🔔", "notification"],
  ["🔕", "mute"],
  ["🔊", "loud"],
  ["🔇", "mute"],
  ["💬", "chat comment"],
  ["💤", "sleep"],
  ["👑", "king queen"],
  ["💎", "diamond"],
  ["🧊", "cold"],
  ["🧨", "dynamite"],
  ["🪦", "rip dead"],
  ["🫤", "meh"],
  ["🫥", "invisible"],
]);

export const EMOJI_NAMES: EmojiEntry[] = EMOJI_GROUPS.flatMap(([, entries]) =>
  entries.map(([emoji, name]) => ({
    emoji,
    name,
    keywords: [KEYWORDS.get(emoji), ...aliasesFor(emoji)]
      .filter(Boolean)
      .join(" "),
  })),
);

const NAME_OF = new Map(EMOJI_NAMES.map((e) => [e.emoji, e.name]));

// Emoji whose name or keywords contain every word of the query.
export function searchEmoji(query: string, limit = 48): EmojiEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: EmojiEntry[] = [];
  for (const e of EMOJI_NAMES) {
    const hay = `${e.name} ${e.keywords ?? ""}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function emojiName(emoji: string): string {
  return NAME_OF.get(emoji) ?? emoji;
}

// Recently used reactions, newest first, as each client stores them: a
// JSON list of strings, at most RECENT_MAX long.
export const RECENT_MAX = 16;

// The list a store holds, or none for anything that isn't one.
export function parseRecent(raw: string | null | undefined): string[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

// The list with emoji at its front, once, and the oldest dropped past
// RECENT_MAX.
export function withRecent(recent: string[], emoji: string): string[] {
  return [emoji, ...recent.filter((item) => item !== emoji)].slice(
    0,
    RECENT_MAX,
  );
}
