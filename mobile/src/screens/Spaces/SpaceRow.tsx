import { badgeCount } from "@stoop/core/unreads";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mentionLabel, type SpaceListing } from "../../api/spaces";
import { MutedIcon } from "../../components/Icons";
import SpaceIcon from "../../components/SpaceIcon";
import { type Theme, tokens, useTheme } from "../../theme";

// One space on the Spaces tab: its icon, its name (bold while something
// in it is unread) over its one-line description, and a mention count or
// an unread dot. A muted space is dimmed and shows neither, as on web's
// rail. Pressed, it opens the space's channels.
export default function SpaceRow({
  listing,
  origin,
  token,
  onPress,
}: {
  listing: SpaceListing;
  origin: string;
  token: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { space, mentions } = listing;
  const unread = !space.muted && space.hasUnread;
  const badge = !space.muted && mentions > 0;

  const label = [
    space.name,
    space.muted
      ? "muted"
      : badge
        ? mentionLabel(mentions)
        : unread
          ? "unread"
          : null,
    space.description,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, space.muted && styles.muted, pressed && styles.pressed]}
    >
      <SpaceIcon name={space.name} fileId={space.iconFileId} origin={origin} token={token} size={44} />
      <View style={styles.text}>
        <Text style={[styles.name, (unread || badge) && styles.bold]} numberOfLines={1}>
          {space.name}
        </Text>
        {space.description !== "" && (
          <Text style={styles.description} numberOfLines={1}>
            {space.description}
          </Text>
        )}
      </View>
      {space.muted ? (
        <MutedIcon color={theme.textMuted} />
      ) : badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeCount(mentions)}</Text>
        </View>
      ) : unread ? (
        <View style={styles.dot} />
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
      minHeight: 68,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    muted: {
      opacity: 0.5,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    name: {
      color: theme.text,
      fontSize: tokens.textBody,
    },
    description: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    bold: {
      fontWeight: "700",
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
    dot: {
      width: 10,
      height: 10,
      marginRight: 6,
      borderRadius: 5,
      backgroundColor: theme.text,
    },
  });
}
