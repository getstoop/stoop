import { type Call, type CallRoom, connectionLine } from "./call";

// The rules of the call bar, which says outside the room's screen that
// the app is in a call (components/CallBarContent.tsx): when it shows,
// and what its two lines say.

// The bar's height on the tabs, which takes the server chip's row.
export const CALL_BAR_HEIGHT = 56;

// Whether the bar shows: in a call or on the way into one. A join that
// failed, or a call that was lost, is its room's screen's to say.
export function callBarShown(call: Call | null): call is Call {
  return !!call && call.status !== "failed";
}

// The room under the call pill, which is the bar under the header of a
// channel, a conversation or a thread (screens/Channel/CallPill.tsx).
export const CALL_PILL_UNDER = 8;

// How far below its screen's header the pill reaches: what the screen's
// list clears besides the header. Nothing while no bar shows
// (`barShown`, callBarShown).
export function callPillClearance(barShown: boolean): number {
  return barShown ? CALL_BAR_HEIGHT + CALL_PILL_UNDER : 0;
}

// The route of a voice room's screen in its server's stack.
export const ROOM_ROUTE = "space/[spaceId]/voice/[channelId]";

// How many screens of a stack lie over the call's room, the nearest
// one to the front: what going back to the room pops, where pushing it
// would put a second copy over the first (a thread opened from the
// room's chat). Undefined with the room not in the stack, or already in
// front. `index` is the screen in front.
export function screensOverRoom(
  routes: readonly { name: string; params?: object }[],
  index: number,
  room: CallRoom,
): number | undefined {
  for (let at = index - 1; at >= 0; at--) {
    const { name, params } = routes[at];
    if (name === ROOM_ROUTE && (params as { channelId?: string } | undefined)?.channelId === room.channelId) {
      return index - at;
    }
  }
  return undefined;
}

// The row by the tab bar: the call bar while it shows, with any number
// of servers; else the server chip, with more than one server saved.
export function tabRow(barShown: boolean, servers: number): "call" | "chip" | null {
  if (barShown) return "call";
  return servers > 1 ? "chip" : null;
}

// The room on a server this account is in, for the Spaces tab to mark
// "You're here": its channel ID once the join has landed, else undefined.
export function hereChannelId(call: Call | null, serverId: string): string | undefined {
  return call?.status === "connected" && call.room.serverId === serverId ? call.room.channelId : undefined;
}

// What the call's server knows of its room, as far as it has loaded:
// names for the bar's lines.
export type CallPlace = {
  roomName: string;
  spaceName: string;
  // This account there, left out of who is speaking.
  meId: string;
  // By user ID.
  names: Record<string, string>;
};

// Who is speaking besides this account, by name; "Someone" for anyone
// the space's members don't have yet. Nobody until the names have
// loaded and this account is known: it can't be told from the others
// before then.
export function speakingNames(call: Call, place: CallPlace | undefined): string[] {
  if (!place?.meId) return [];
  return call.speaking.filter((userId) => userId !== place.meId).map((userId) => place.names[userId] ?? "Someone");
}

// "Priya is speaking", "Priya and Theo are speaking", then "Priya and 2
// others are speaking". "" for nobody.
export function speakingLine(names: string[]): string {
  switch (names.length) {
    case 0:
      return "";
    case 1:
      return `${names[0]} is speaking`;
    case 2:
      return `${names[0]} and ${names[1]} are speaking`;
    default:
      return `${names[0]} and ${names.length - 1} others are speaking`;
  }
}

// The bar's second line: "Connecting…" on the way in, then who is
// speaking, or the room's space while nobody is; "Reconnecting…" while
// the connection is being tried again, and "Establishing connection…" while
// the server has yet to say this account is in the room. `serverName` is the
// call's server when another server is on screen, else "", and goes
// first: "Hutch House · Theo is speaking".
export function callBarStatus(call: Call, place: CallPlace | undefined, serverName: string): string {
  const what =
    call.status === "connecting"
      ? "Connecting…"
      : connectionLine(call) || speakingLine(speakingNames(call, place)) || (place?.spaceName ?? "");
  return [serverName, what].filter(Boolean).join(" · ") || "In a call";
}

// The bar's first line: the room, once its name has loaded.
export const callBarName = (place: CallPlace | undefined) => place?.roomName || "Voice room";

// What a screen reader is told of the bar's main area.
export function callBarLabel(name: string, status: string): string {
  return `In ${name}. ${status}. Back to the call`;
}
