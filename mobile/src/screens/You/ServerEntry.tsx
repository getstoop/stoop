import { badgeCount } from "@stoop/core/unreads";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { hostOf } from "../../api/probe";
import { mentionLabel } from "../../api/spaces";
import type { SavedServer } from "../../servers";
import type { Waiting } from "../../servers/useWaiting";
import { type Theme, tokens, useTheme } from "../../theme";

// A server in the You tab's list: its first letter and name, and "Current",
// a mention count, or "Signed out" with its tile dimmed. Without onPress
// it only shows, as the card over its menu.
export default function ServerEntry({
  server,
  current,
  waiting,
  divided,
  onPress,
  onLongPress,
  onRemove,
}: {
  server: SavedServer;
  current: boolean;
  waiting?: Waiting;
  divided?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
}) {
  const styles = makeStyles(useTheme());
  const ended = !current && waiting?.state === "ended";
  const mentions = !current && waiting?.state === "ready" ? waiting.mentions : 0;
  const label = [
    server.name,
    hostOf(server.origin),
    current ? "current server" : ended ? "signed out" : mentions > 0 ? mentionLabel(mentions) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityActions={onRemove ? [{ name: "remove", label: "Remove from this phone" }] : undefined}
      onAccessibilityAction={onRemove}
      disabled={!onPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, divided && styles.divided, pressed && styles.pressed]}
    >
      <View style={[styles.tile, ended && styles.dim]}>
        <Text style={styles.letter}>{server.name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {server.name}
      </Text>
      {current && <Text style={styles.note}>Current</Text>}
      {ended && <Text style={styles.ended}>Signed out</Text>}
      {mentions > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount(mentions)}</Text>
        </View>
      )}
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 14,
      backgroundColor: theme.panel,
    },
    divided: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    tile: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    dim: {
      opacity: tokens.disabled,
    },
    letter: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
    name: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    note: {
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
