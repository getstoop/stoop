import type { CallRoom } from "./call";

// The call's room, asked for from the call bar while another server was
// on screen: held, outside React, across the swap to its server, whose
// layout opens it (OpenCallRoom.tsx). Taken once.
let pending: CallRoom | null = null;

export function askForRoom(room: CallRoom) {
  pending = room;
}

// The room asked for, if it is on this server. Whichever server's
// layout asks, it waits no more: a swap that landed elsewhere must not
// open the room on some later visit.
export function takeRoom(serverId: string): CallRoom | null {
  const room = pending;
  pending = null;
  return room?.serverId === serverId ? room : null;
}
