import { badgeCount } from "@stoop/core/unreads";
import { type Channel, ChannelPostPolicy } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { StyleSheet, Text, View } from "react-native";
import { mentionLabel } from "../../api/spaces";
import { LockIcon, MegaphoneIcon, MutedIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// One text channel: its mark (# or, as on web, a lock for a private
// channel and a megaphone for an announcement channel), its name, bold
// while it has unread messages, and a mention count or an unread dot. A
// muted channel is dimmed and shows neither, and nothing is waiting
// anywhere in a muted space. Not a button yet: the channel itself is the
// next screen.
export default function ChannelRow({
  channel,
  spaceMuted,
  mentions,
}: {
  channel: Channel;
  spaceMuted: boolean;
  mentions: number;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const quiet = spaceMuted || channel.muted;
  const unread = !quiet && channel.unreadCount > 0;
  const badge = !quiet && mentions > 0;
  const announcement = channel.postPolicy === ChannelPostPolicy.ADMINS;

  const label = [
    channel.name,
    channel.private ? "private" : announcement ? "announcements" : null,
    channel.muted ? "muted" : badge ? mentionLabel(mentions) : unread ? "unread" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={[styles.row, channel.muted && styles.muted]} accessible accessibilityLabel={label}>
      <View style={styles.mark}>
        {channel.private ? (
          <LockIcon color={theme.textMuted} />
        ) : announcement ? (
          <MegaphoneIcon color={theme.textMuted} />
        ) : (
          <Text style={styles.hash}>#</Text>
        )}
      </View>
      <Text style={[styles.name, (unread || badge) && styles.bold]} numberOfLines={1}>
        {channel.name}
      </Text>
      {channel.muted ? (
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

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
      paddingHorizontal: 12,
    },
    muted: {
      opacity: 0.5,
    },
    mark: {
      width: 20,
      alignItems: "center",
    },
    hash: {
      color: theme.textMuted,
      fontSize: tokens.textLg,
    },
    name: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textBody,
    },
    bold: {
      color: theme.text,
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
      width: 8,
      height: 8,
      marginRight: 7,
      borderRadius: 4,
      backgroundColor: theme.text,
    },
  });
}
