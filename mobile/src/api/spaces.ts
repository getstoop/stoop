import { unreadCounts } from "@stoop/core/activity";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { chatClient } from "./clients";

// The Spaces tab's list: the spaces the signed-in account is in, in the
// order it joined them (as web's rail), each with what is waiting in it.
// A snapshot, fetched again on pull and on coming back to the app; live
// updates arrive with the realtime gateway.

export type SpaceListing = {
  space: Space;
  // Unread mentions and replies addressed to this account, as web's rail
  // badge counts them (core/activity.ts → unreadCounts): from the first
  // page of Activity, leaving out what the server stamped muted and thread
  // replies.
  mentions: number;
};

const TIMEOUT_MS = 10000;

export async function loadSpaces(
  origin: string,
  token: string,
  signal?: AbortSignal,
): Promise<SpaceListing[]> {
  const chat = chatClient(origin, token);
  const options = { signal, timeoutMs: TIMEOUT_MS };
  const [{ spaces }, activity] = await Promise.all([
    chat.listSpaces({}, options),
    chat.listActivity({}, options),
  ]);
  const { bySpace } = unreadCounts(activity);
  return spaces.map((space) => ({ space, mentions: bySpace.get(space.id) ?? 0 }));
}

// "1 mention", "3 mentions": a badge's count as a screen reader says it.
export function mentionLabel(n: number): string {
  return n === 1 ? "1 mention" : `${n} mentions`;
}

// What is waiting on a whole server, for its badge in the switcher: the
// mentions in every space that isn't muted, as the Spaces tab badges them.
export async function mentionTotal(origin: string, token: string): Promise<number> {
  const listings = await loadSpaces(origin, token);
  return listings.reduce((n, l) => (l.space.muted ? n : n + l.mentions), 0);
}
