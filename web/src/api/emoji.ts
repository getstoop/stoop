// The reaction picker's emoji set: the full Unicode list (generated into
// emojiData.ts, grouped in CLDR order) plus a curated row of the usual
// suspects and hand-written search keywords for the common ones. Custom
// emoji per space will arrive with file uploads and fit the same shape.

import { EMOJI_GROUPS } from "./emojiData";
import { aliasesFor } from "./shortcodes";

export type EmojiEntry = { emoji: string; name: string; keywords?: string };

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

// Recently used reactions, newest first, per browser. localStorage can be
// missing or throw (private mode, blocked storage), so every access is
// guarded and a failure just means no recents.
const RECENT_KEY = "stoop.recentEmoji";
const RECENT_MAX = 16;

export function recentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): string[] {
  const next = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(
    0,
    RECENT_MAX,
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable; the picker just won't remember.
  }
  return next;
}
