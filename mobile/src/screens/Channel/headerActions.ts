// What a channel's header, a conversation's and a thread's hold at the
// right, in one capsule (ScreenHeader): Search, where there is a space
// to search, and the bell that mutes what the screen shows.

export type HeaderSearch = {
  spaceName: string;
  onPress: () => void;
};

export const searchLabel = (spaceName: string): string => `Search in ${spaceName}`;

export type HeaderMute = {
  // Drawn as the slashed bell.
  muted: boolean;
  // What a screen reader calls the bell: what a press would do, or why
  // it would do nothing.
  label: string;
  // The server hasn't answered the last press yet.
  pending: boolean;
  // Muted by what holds it (a channel by its space, a thread by its
  // channel), which silences it already: shown, and can't be changed
  // here, as on web.
  held: boolean;
  onPress: () => void;
};

// A channel's bell, a conversation's too (no space): a muted space
// mutes all of its channels, and a channel cannot be louder than its
// space.
export function channelMute(
  kind: "channel" | "conversation",
  muted: boolean,
  spaceMuted: boolean,
): Pick<HeaderMute, "muted" | "label" | "held"> {
  if (spaceMuted) return { muted: true, held: true, label: "Channel muted: its space is muted" };
  return { muted, held: false, label: `${muted ? "Unmute" : "Mute"} ${kind}` };
}

// A thread's: under a muted channel it shows the thread muted by its
// channel.
export function threadMute(muted: boolean, channelMuted: boolean): Pick<HeaderMute, "muted" | "label" | "held"> {
  if (channelMuted) return { muted: true, held: true, label: "Thread muted: its channel is muted" };
  return { muted, held: false, label: muted ? "Unmute thread" : "Mute thread" };
}
