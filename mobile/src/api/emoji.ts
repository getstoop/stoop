import { parseRecent, withRecent } from "@stoop/core/emoji";
import * as SecureStore from "expo-secure-store";

// The reactions this phone used recently, newest first, for the picker's
// "Recently used" row: web's recentEmoji and rememberEmoji (web/src/api
// emoji.ts) over the keychain, the app's one store so far (beside the
// theme and the server list), with the list's rules in core/emoji.ts.
// A store that fails only means no recents, or a pick not remembered.

const KEY = "recentEmoji";

export async function recentEmoji(): Promise<string[]> {
  try {
    return parseRecent(await SecureStore.getItemAsync(KEY));
  } catch {
    return [];
  }
}

export async function rememberEmoji(emoji: string): Promise<string[]> {
  const next = withRecent(await recentEmoji(), emoji);
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch {
    // The picker just won't remember.
  }
  return next;
}
