import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import type { ServerEvent } from "@stoop/gen/stoop/realtime/v1/realtime_pb";
import { eventSpaceId } from "./channels";
import { chatClient } from "./clients";

// The Spaces tab's rail: the spaces the signed-in account is in, in the
// order it joined them (as web's rail), each carrying what is waiting in
// it (`hasUnread`, `alertCount`, `muted`, the caller's own). A snapshot,
// fetched on opening, on pull, on coming back to the app, and again when
// the realtime socket says it could have changed (`touchesSpaces`).

const TIMEOUT_MS = 10000;

export async function loadSpaces(origin: string, token: string, signal?: AbortSignal): Promise<Space[]> {
  const { spaces } = await chatClient(origin, token).listSpaces({}, { signal, timeoutMs: TIMEOUT_MS });
  return spaces;
}

// "1 mention", "3 mentions": a badge's count as a screen reader says it.
export function mentionLabel(n: number): string {
  return n === 1 ? "1 mention" : `${n} mentions`;
}

// Whether an event could change the rail: a space joined (SpaceJoined
// is the account's own; leaving, being removed and a space deleted are
// among the next), or anything that could change what one space's
// channels show (`eventSpaceId`), in any space, since each is also what
// the space's mark and badge are counted from. Ready follows a
// reconnect, when anything may have been missed. An event in a direct
// message is no space's.
export function touchesSpaces(event: ServerEvent): boolean {
  if (event.payload.case === "ready" || event.payload.case === "spaceJoined") return true;
  const spaceId = eventSpaceId(event);
  return spaceId !== undefined && spaceId !== "";
}
