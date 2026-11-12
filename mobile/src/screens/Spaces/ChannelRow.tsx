import { badgeCount } from "@stoop/core/unreads";
import { type Channel, ChannelPostPolicy } from "@stoop/gen/stoop/chat/v1/channel_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mentionLabel } from "../../api/spaces";
import { MutedIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelMark from "./ChannelMark";
import { type ChannelAction, channelRowActions } from "./channelMenuRules";

// One text channel: its mark (ChannelMark), its name, bold while it has
// unread messages, and a mention count (the channel's
// `alertCount`, docs/architecture/messaging.md → Alert counts) or an
// unread dot. A muted channel is dimmed and shows neither, and nothing
// is waiting anywhere in a muted space; the server already counts a
// muted channel as 0, so the check here only keeps the row honest.
// Pressing it opens the channel and a long press its menu (ChannelMenu),
// whose items a screen reader is given as the row's own actions. Drawn
// as that menu's card, it takes neither.
export default function ChannelRow({
  channel,
  spaceMuted,
  onPress,
  onLongPress,
  onAction,
}: {
  channel: Channel;
  spaceMuted: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onAction?: (action: ChannelAction) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const mentions = channel.alertCount;
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
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityActions={onAction && channelRowActions(channel, spaceMuted)}
      onAccessibilityAction={(event) => onAction?.(event.nativeEvent.actionName as ChannelAction)}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, channel.muted && styles.muted, pressed && styles.pressed]}
    >
      <ChannelMark channel={channel} />
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
    </Pressable>
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
      borderRadius: tokens.radiusMd,
    },
    muted: {
      opacity: 0.5,
    },
    pressed: {
      backgroundColor: theme.hover,
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
