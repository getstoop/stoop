import type { NativeStackHeaderItemButton } from "expo-router";

// The thread header's bell, as either platform draws it: on iOS a bar
// button item (muteItem), which the system draws as it draws the back
// button, Liquid Glass from iOS 26; elsewhere MuteButton. Both take
// these props.
export type MuteProps = {
  muted: boolean;
  // The thread's channel is muted, which silences it already: shown,
  // and can't be changed here, as on web.
  channelMuted: boolean;
  // The server hasn't answered the last tap yet.
  pending: boolean;
  onPress: () => void;
};

export function muteLabel({ muted, channelMuted }: Pick<MuteProps, "muted" | "channelMuted">): string {
  if (channelMuted) return "Thread muted: its channel is muted";
  return muted ? "Unmute thread" : "Mute thread";
}

export function muteItem(props: MuteProps): NativeStackHeaderItemButton {
  const { muted, channelMuted, pending, onPress } = props;
  const label = muteLabel(props);
  return {
    type: "button",
    label,
    accessibilityLabel: label,
    icon: { type: "sfSymbol", name: muted || channelMuted ? "bell.slash" : "bell" },
    disabled: pending || channelMuted,
    onPress,
  };
}
