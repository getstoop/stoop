import type { FocusedPlace } from "./focus";

// What a notification would be about, as far as staying quiet goes.
// Where it landed is in an activity item and in a notification's data
// alike; muted and read are the item's alone, and are left out by a
// caller that has only the data. Held is do not disturb, the phone's
// switch or the server's account's (src/dnd), a plain answer so whatever
// raises a notification can give it. An empty threadRootId is no thread,
// as the server sends it.
export type Arrival = {
  serverId: string;
  channelId: string;
  threadRootId?: string;
  muted?: boolean;
  read?: boolean;
  held?: boolean;
};

// Whether an arrival gets no notification: it came from somewhere muted
// (the server's stamp, so it holds for a space never opened here), it is
// read already, do not disturb holds it, or the person is reading where
// it landed. A thread's
// reply is quiet only on that thread's screen, so it still rings while
// its channel is the screen; anything else is quiet on its channel's.
export function staysQuiet(arrival: Arrival, focused: FocusedPlace | null): boolean {
  if (arrival.muted || arrival.read || arrival.held) return true;
  if (!focused || focused.serverId !== arrival.serverId) return false;
  if (arrival.threadRootId) return focused.threadRootId === arrival.threadRootId;
  return !focused.threadRootId && focused.channelId === arrival.channelId;
}
