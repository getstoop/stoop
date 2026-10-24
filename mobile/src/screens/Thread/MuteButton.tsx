import { Pressable, StyleSheet, View } from "react-native";
import { BellIcon, MutedIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import { type MuteProps, muteLabel } from "./muteItem";

// The thread header's bell where it isn't a bar button item (muteItem):
// Mute thread, or Unmute thread under the slashed bell once muted,
// dimmed while the server answers. Under a muted channel, as on web, it
// shows the thread muted by its channel and can't change it.
export default function MuteButton({ muted, channelMuted, pending, onPress }: MuteProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  if (channelMuted) {
    return (
      <View
        style={[styles.button, styles.dim]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={muteLabel({ muted, channelMuted })}
        accessibilityState={{ disabled: true, selected: true }}
      >
        <MutedIcon color={theme.textMuted} size={22} />
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={muteLabel({ muted, channelMuted })}
      accessibilityState={{ selected: muted, disabled: pending, busy: pending }}
      disabled={pending}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, pending && styles.dim]}
    >
      {muted ? <MutedIcon color={theme.textMuted} size={22} /> : <BellIcon color={theme.textMuted} size={22} />}
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    button: {
      width: 44,
      height: 44,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    dim: {
      opacity: tokens.disabled,
    },
  });
}
