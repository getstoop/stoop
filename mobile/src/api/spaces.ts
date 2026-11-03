import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { chatClient } from "./clients";

// The Spaces tab's list: the spaces the signed-in account is in, in the
// order it joined them (as web's rail), each carrying what is waiting in
// it (`hasUnread`, `alertCount`, `muted`, the caller's own). A snapshot,
// fetched on opening, on pull and on coming back to the app; the tab
// listens to the socket only for its sign-in ending.

const TIMEOUT_MS = 10000;

export async function loadSpaces(origin: string, token: string, signal?: AbortSignal): Promise<Space[]> {
  const { spaces } = await chatClient(origin, token).listSpaces({}, { signal, timeoutMs: TIMEOUT_MS });
  return spaces;
}

// "1 mention", "3 mentions": a badge's count as a screen reader says it.
export function mentionLabel(n: number): string {
  return n === 1 ? "1 mention" : `${n} mentions`;
}
