import { Pressable, StyleSheet, Text, View } from "react-native";
import { hostOf } from "../../api/probe";
import { badgeCount, mentionLabel } from "../../api/spaces";
import { CheckIcon } from "../../components/Icons";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";

// What the switcher learned about a server that isn't the current one.
export type Waiting =
  | { state: "ready"; mentions: number }
  | { state: "ended" }
  | { state: "failed" };

// One server in the switcher: its first letter, its name over its
// address, and a tick on the current one or a mention count on another.
// A server whose sign-in has ended is dimmed and says so instead of its
// address; tapping it signs in again.
export default function ServerRow({
  server,
  current,
  waiting,
  onPress,
}: {
  server: SavedServer;
  current: boolean;
  waiting?: Waiting;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const host = hostOf(server.origin);
  const ended = waiting?.state === "ended";
  const mentions = waiting?.state === "ready" ? waiting.mentions : 0;

  const label = [
    server.name,
    host,
    current ? "current server" : ended ? "signed out" : mentions > 0 ? mentionLabel(mentions) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, current && styles.current, pressed && styles.pressed]}
    >
      <View style={[styles.tile, ended && styles.dim]}>
        <Text style={styles.letter}>{server.name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {server.name}
        </Text>
        {ended ? (
          <Text style={styles.ended} numberOfLines={1}>
            Signed out · tap to sign in again
          </Text>
        ) : (
          <Text style={styles.host} numberOfLines={1}>
            {host}
          </Text>
        )}
      </View>
      {current ? (
        <CheckIcon color={theme.accent} size={20} />
      ) : mentions > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount(mentions)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    current: {
      backgroundColor: theme.raised,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    tile: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    dim: {
      opacity: tokens.disabled,
    },
    letter: {
      color: theme.accent,
      fontSize: tokens.textLg,
      fontWeight: "700",
    },
    text: {
      flex: 1,
      gap: 2,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    host: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    ended: {
      color: theme.warn,
      fontSize: tokens.textUi,
    },
    badge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 7,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    badgeText: {
      color: theme.onAccent,
      fontSize: tokens.textSm,
      fontWeight: "700",
    },
  });
}
