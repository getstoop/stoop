import type { Call } from "./call";

// The rules of the call bar, which says outside the room's screen that
// the app is in a call (components/CallBarContent.tsx): when it shows,
// and what its two lines say.

// The bar's height on the tabs, which takes the server chip's row.
export const CALL_BAR_HEIGHT = 56;

// Whether the bar shows: in a call or on the way into one. A join that
// failed is its room's screen's to say.
export function callBarShown(call: Call | null): call is Call {
  return !!call && call.status !== "failed";
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
// loaded: this account can't be told from the others before then.
export function speakingNames(call: Call, place: CallPlace | undefined): string[] {
  if (!place) return [];
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
// speaking, or the room's space while nobody is. `serverName` is the
// call's server when another server is on screen, else "", and goes
// first: "Hutch House · Theo is speaking".
export function callBarStatus(call: Call, place: CallPlace | undefined, serverName: string): string {
  const what =
    call.status === "connecting" ? "Connecting…" : speakingLine(speakingNames(call, place)) || (place?.spaceName ?? "");
  return [serverName, what].filter(Boolean).join(" · ") || "In a call";
}

// The bar's first line: the room, once its name has loaded.
export const callBarName = (place: CallPlace | undefined) => place?.roomName || "Voice room";

// What a screen reader is told of the bar's main area.
export function callBarLabel(name: string, status: string): string {
  return `In ${name}. ${status}. Back to the call`;
}
