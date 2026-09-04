// :shortcode: emoji. Names come from two places: every Unicode name in
// the generated list, snake_cased ("loudly_crying_face", "flag_canada"),
// and a curated alias map in the GitHub/Slack tradition ("sob", "+1",
// "tada"). Aliases win when they collide. Messages are sent with the
// shortcodes already replaced by the emoji, so nothing downstream needs
// to know about them; custom per-space emoji will keep the :name: form.

import { EMOJI_GROUPS } from "./emojiData";

export type Shortcode = { code: string; emoji: string };

export const ALIASES: [string, string][] = [
  ["+1", "👍"],
  ["thumbsup", "👍"],
  ["-1", "👎"],
  ["thumbsdown", "👎"],
  ["heart", "❤️"],
  ["broken_heart", "💔"],
  ["smile", "😄"],
  ["grin", "😁"],
  ["grinning", "😀"],
  ["laughing", "😆"],
  ["joy", "😂"],
  ["rofl", "🤣"],
  ["lol", "😂"],
  ["sweat_smile", "😅"],
  ["wink", "😉"],
  ["blush", "😊"],
  ["innocent", "😇"],
  ["heart_eyes", "😍"],
  ["kissing_heart", "😘"],
  ["yum", "😋"],
  ["stuck_out_tongue", "😛"],
  ["zany", "🤪"],
  ["hugs", "🤗"],
  ["thinking", "🤔"],
  ["salute", "🫡"],
  ["neutral_face", "😐"],
  ["expressionless", "😑"],
  ["smirk", "😏"],
  ["unamused", "😒"],
  ["roll_eyes", "🙄"],
  ["eyeroll", "🙄"],
  ["grimacing", "😬"],
  ["relieved", "😌"],
  ["pensive", "😔"],
  ["sleeping", "😴"],
  ["sleepy", "😪"],
  ["mask", "😷"],
  ["nauseated", "🤢"],
  ["vomiting", "🤮"],
  ["hot_face", "🥵"],
  ["cold_face", "🥶"],
  ["dizzy_face", "😵"],
  ["exploding_head", "🤯"],
  ["mind_blown", "🤯"],
  ["partying_face", "🥳"],
  ["party", "🥳"],
  ["sunglasses", "😎"],
  ["cool", "😎"],
  ["nerd", "🤓"],
  ["confused", "😕"],
  ["worried", "😟"],
  ["frowning", "🙁"],
  ["open_mouth", "😮"],
  ["astonished", "😲"],
  ["flushed", "😳"],
  ["pleading", "🥺"],
  ["cry", "😢"],
  ["crying", "😢"],
  ["sob", "😭"],
  ["scream", "😱"],
  ["triumph", "😤"],
  ["rage", "😡"],
  ["angry", "😠"],
  ["cursing", "🤬"],
  ["skull", "💀"],
  ["poop", "💩"],
  ["clown", "🤡"],
  ["ghost", "👻"],
  ["alien", "👽"],
  ["robot", "🤖"],
  ["wave", "👋"],
  ["ok_hand", "👌"],
  ["v", "✌️"],
  ["peace", "✌️"],
  ["crossed_fingers", "🤞"],
  ["metal", "🤘"],
  ["point_up", "☝️"],
  ["point_left", "👈"],
  ["point_right", "👉"],
  ["fist", "✊"],
  ["punch", "👊"],
  ["clap", "👏"],
  ["raised_hands", "🙌"],
  ["handshake", "🤝"],
  ["pray", "🙏"],
  ["muscle", "💪"],
  ["eyes", "👀"],
  ["brain", "🧠"],
  ["dog", "🐶"],
  ["cat", "🐱"],
  ["bee", "🐝"],
  ["bug", "🐛"],
  ["snake", "🐍"],
  ["crab", "🦀"],
  ["unicorn", "🦄"],
  ["goat", "🐐"],
  ["star", "⭐"],
  ["star2", "🌟"],
  ["sparkles", "✨"],
  ["zap", "⚡"],
  ["fire", "🔥"],
  ["boom", "💥"],
  ["snowflake", "❄️"],
  ["sunny", "☀️"],
  ["moon", "🌙"],
  ["rainbow", "🌈"],
  ["ocean", "🌊"],
  ["coffee", "☕"],
  ["beer", "🍺"],
  ["beers", "🍻"],
  ["champagne", "🥂"],
  ["wine", "🍷"],
  ["pizza", "🍕"],
  ["taco", "🍔"],
  ["burger", "🍔"],
  ["cake", "🎂"],
  ["cookie", "🍪"],
  ["popcorn", "🍿"],
  ["trophy", "🏆"],
  ["dart", "🎯"],
  ["gift", "🎁"],
  ["balloon", "🎈"],
  ["tada", "🎉"],
  ["confetti_ball", "🎊"],
  ["rocket", "🚀"],
  ["car", "🚗"],
  ["bike", "🚲"],
  ["airplane", "✈️"],
  ["house", "🏠"],
  ["bulb", "💡"],
  ["idea", "💡"],
  ["lock", "🔒"],
  ["unlock", "🔓"],
  ["key", "🔑"],
  ["hammer", "🔨"],
  ["wrench", "🔧"],
  ["gear", "⚙️"],
  ["pill", "💊"],
  ["moneybag", "💰"],
  ["gem", "💎"],
  ["crown", "👑"],
  ["bell", "🔔"],
  ["no_bell", "🔕"],
  ["zzz", "💤"],
  ["100", "💯"],
  ["white_check_mark", "✅"],
  ["check", "✅"],
  ["heavy_check_mark", "✔️"],
  ["x", "❌"],
  ["question", "❓"],
  ["exclamation", "❗"],
  ["warning", "⚠️"],
  ["no_entry_sign", "🚫"],
  ["recycle", "♻️"],
  ["alarm_clock", "⏰"],
  ["hourglass", "⏳"],
  ["speech_balloon", "💬"],
  ["memo", "📝"],
  ["pushpin", "📌"],
  ["books", "📚"],
  ["computer", "💻"],
  ["phone", "📱"],
  ["camera", "📷"],
  ["headphones", "🎧"],
  ["guitar", "🎸"],
  ["music", "🎵"],
  ["game", "🎮"],
  ["dice", "🎲"],
  ["soccer", "⚽"],
  ["basketball", "🏀"],
  ["football", "🏈"],
  ["pride", "🏳️‍🌈"],
  ["checkered_flag", "🏁"],
];

// "Loudly crying face" → "loudly_crying_face"; "flag: Canada" → "flag_canada".
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9+]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Suggestion order: aliases first (short, familiar), then the Unicode names.
export const SHORTCODES: Shortcode[] = (() => {
  const seen = new Set<string>();
  const out: Shortcode[] = [];
  const add = (code: string, emoji: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, emoji });
  };
  for (const [code, emoji] of ALIASES) add(code, emoji);
  for (const [, entries] of EMOJI_GROUPS)
    for (const [emoji, name] of entries) add(slug(name), emoji);
  return out;
})();

const BY_CODE = new Map(SHORTCODES.map((s) => [s.code, s.emoji]));

export function emojiForShortcode(code: string): string | undefined {
  return BY_CODE.get(code.toLowerCase());
}

// Every alias for an emoji, for search keywords.
const ALIASES_BY_EMOJI = new Map<string, string[]>();
for (const [code, emoji] of ALIASES) {
  ALIASES_BY_EMOJI.set(emoji, [...(ALIASES_BY_EMOJI.get(emoji) ?? []), code]);
}
export function aliasesFor(emoji: string): string[] {
  return ALIASES_BY_EMOJI.get(emoji) ?? [];
}

const CODE_CHARS = "a-z0-9_+\\-";
const SHORTCODE_TOKEN = new RegExp(`:([${CODE_CHARS}]{2,}):`, "gi");
const CODE_SPANS = /(```[\s\S]*?```|`[^`\n]+`)/;

// Replaces every known :shortcode: outside code with its emoji; unknown
// ones (and things like 10:30:45) are left alone.
export function replaceShortcodes(text: string): string {
  return text
    .split(CODE_SPANS)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg.replace(SHORTCODE_TOKEN, (m, code: string) => {
            const emoji = emojiForShortcode(code);
            return emoji ?? m;
          }),
    )
    .join("");
}

const QUERY_AT = new RegExp(`(?:^|\\s):([${CODE_CHARS}]{2,})$`, "i");

// The :query being typed at the caret, if any: "so :so|" → "so".
export function shortcodeQueryAt(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const m = QUERY_AT.exec(value.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1].toLowerCase() };
}

// Prefix matches first, then anything containing the query; one entry per
// emoji so 👍 doesn't show up as both +1 and thumbsup.
export function searchShortcodes(query: string, limit = 8): Shortcode[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: Shortcode[] = [];
  const seen = new Set<string>();
  const take = (pred: (s: Shortcode) => boolean) => {
    for (const s of SHORTCODES) {
      if (out.length >= limit) return;
      if (!seen.has(s.emoji) && pred(s)) {
        seen.add(s.emoji);
        out.push(s);
      }
    }
  };
  take((s) => s.code.startsWith(q));
  take((s) => s.code.includes(q));
  return out;
}
