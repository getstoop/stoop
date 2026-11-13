import { badgeCount } from "@stoop/core/unreads";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useWaitingElsewhere } from "../alerts/AlertsProvider";
import { usePushOnce } from "../hooks/usePushOnce";
import { SERVER_CHIP_HEIGHT } from "../hooks/useServerChipRoom";
import { useCurrentServer } from "../servers";
import { type Theme, tokens, useTheme } from "../theme";
import { ChevronUpIcon } from "./Icons";

// The server switcher, a row docked on the tab bar: the current
// server's tile and name, a badge for what waits on the other servers
// added up (the tabs' badge; src/alerts), and a chevron up to the sheet
// it opens, the server switcher, which rises from the same end of the
// screen. Drawn only with more than one server saved
// (hooks/useServerChipRoom.ts): with one there is nothing to switch to.
// `bare` is the row in the system tab bar's own slot (iOS 26,
// ServerChipSlot.tsx), which draws the glass under it: no panel, no
// line.
export default function ServerChip({ bare = false }: { bare?: boolean }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const pushOnce = usePushOnce();
  const server = useCurrentServer();
  const waiting = useWaitingElsewhere();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        waiting > 0
          ? `${server.name}. Switch server, ${badgeCount(waiting)} new on other servers`
          : `${server.name}. Switch server`
      }
      testID="server-switcher"
      onPress={() => pushOnce(() => router.push({ pathname: "/servers", params: { current: server.id } }))}
      style={({ pressed }) => [styles.chip, bare ? pressed && styles.barePressed : [styles.docked, pressed && styles.pressed]]}
    >
      <View style={styles.tile}>
        <Text style={styles.tileLetter}>{server.name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={styles.server} numberOfLines={1}>
        {server.name}
      </Text>
      {waiting > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount(waiting)}</Text>
        </View>
      )}
      <ChevronUpIcon color={theme.textMuted} />
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      height: SERVER_CHIP_HEIGHT,
      paddingHorizontal: 16,
    },
    docked: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      backgroundColor: theme.panel,
    },
    pressed: {
      backgroundColor: theme.raised,
    },
    barePressed: {
      opacity: 0.6,
    },
    tile: {
      width: 28,
      height: 28,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    tileLetter: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
    server: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    // The tabs' badge, in their colour.
    badge: {
      minWidth: 22,
      height: 22,
      paddingHorizontal: 7,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.danger,
    },
    badgeText: {
      color: theme.onAccent,
      fontSize: tokens.textSm,
      fontWeight: "700",
    },
  });
}
