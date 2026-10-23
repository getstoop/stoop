// The reaction picker's emoji: the set, the names and the search are
// core/emoji.ts, shared with the phone; what this browser used recently
// lives in localStorage here.

import { parseRecent, withRecent } from "../core/emoji";

export {
  COMMON_EMOJI,
  EMOJI_NAMES,
  type EmojiEntry,
  emojiName,
  searchEmoji,
} from "../core/emoji";

// Recently used reactions, newest first, per browser. localStorage can be
// missing or throw (private mode, blocked storage), so every access is
// guarded and a failure just means no recents.
const RECENT_KEY = "stoop.recentEmoji";

export function recentEmoji(): string[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): string[] {
  const next = withRecent(recentEmoji(), emoji);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable; the picker just won't remember.
  }
  return next;
}
