import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { badgeCount, mentionLabel, type SpaceListing } from "../../api/spaces";
import { MutedIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// One space on the Spaces tab: its icon, its name (bold while something
// in it is unread) over its one-line description, and a mention count or
// an unread dot. A muted space is dimmed and shows neither, as on web's
// rail. Not a button yet: the space's channels are the next screen.
export default function SpaceRow({
  listing,
  origin,
  token,
}: {
  listing: SpaceListing;
  origin: string;
  token: string;
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
    <View style={[styles.row, space.muted && styles.muted]} accessible accessibilityLabel={label}>
      <SpaceIcon name={space.name} fileId={space.iconFileId} origin={origin} token={token} styles={styles} />
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
    </View>
  );
}

// The space's icon, fetched with the session as a bearer token (the
// server takes it on /files as on every RPC), or its first letter when it
// has none or the icon won't load.
function SpaceIcon({
  name,
  fileId,
  origin,
  token,
  styles,
}: {
  name: string;
  fileId: string;
  origin: string;
  token: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [failed, setFailed] = useState(false);
  if (fileId && !failed) {
    return (
      <Image
        source={{ uri: `${origin}/files/${fileId}`, headers: { Authorization: `Bearer ${token}` } }}
        style={styles.icon}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={styles.icon}>
      <Text style={styles.letter}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
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
    },
    muted: {
      opacity: 0.5,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: tokens.radiusLg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
      overflow: "hidden",
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
