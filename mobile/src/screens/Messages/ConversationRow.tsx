import { timestampDate } from "@bufbuild/protobuf/wkt";
import { dmFaces, dmIsGroup, dmOther, dmPreview, dmTime, dmTitle } from "@stoop/core/dms";
import { presenceLabel } from "@stoop/core/presence";
import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MutedIcon } from "../../components/Icons";
import { usePresence } from "../../realtime/RealtimeProvider";
import { type Theme, tokens, useTheme } from "../../theme";
import ConversationFaces from "../../components/ConversationFaces";

// One conversation in the Messages tab: who it is with, when it last
// moved, and its newest message on one line. Unread, the name is bold
// and a dot ends the line, unless it is muted. With one other person,
// their presence sits on their face; a group has none, as on web. A
// press opens the conversation and a long press its menu
// (ConversationMenu), whose items a screen reader is given as the row's
// own actions. Drawn as that menu's card, it takes neither.

export type ConversationAction = "mute" | "copyLink" | "close";

export default memo(function ConversationRow({
  dm,
  meId,
  serverId,
  origin,
  token,
  onPress,
  onLongPress,
  onAction,
}: {
  dm: DirectMessage;
  meId: string;
  serverId: string;
  origin: string;
  token: string;
  onPress?: (dm: DirectMessage) => void;
  onLongPress?: (dm: DirectMessage) => void;
  onAction?: (dm: DirectMessage, action: ConversationAction) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const channel = dm.channel;
  const title = dmTitle(dm, meId);
  const preview = dmPreview(dm, meId);
  const sent = dm.lastMessage?.createdAt;
  const when = sent ? dmTime(timestampDate(sent)) : "";
  const muted = channel?.muted ?? false;
  const unread = !muted && (channel?.unreadCount ?? 0) > 0;
  const other = dmIsGroup(dm) ? undefined : dmOther(dm, meId);
  const presence = usePresence(serverId, other?.id);
  const status = presence && presenceLabel(presence.online, presence.dnd, presence.mobile);
  const label = [title, status, muted && "muted", unread && "unread", when, preview].filter(Boolean).join(", ");
  const actions = onAction
    ? [
        { name: "mute", label: muted ? "Unmute" : "Mute" },
        { name: "copyLink", label: "Copy link" },
        { name: "close", label: "Close conversation" },
      ]
    : undefined;

  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityActions={actions}
      onAccessibilityAction={(event) => onAction?.(dm, event.nativeEvent.actionName as ConversationAction)}
      testID={onPress ? `conversation-${channel?.id ?? ""}` : undefined}
      onPress={() => onPress?.(dm)}
      onLongPress={onLongPress && (() => onLongPress(dm))}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <ConversationFaces faces={dmFaces(dm, meId)} presence={presence} origin={origin} token={token} />
      <View style={styles.main}>
        <View style={styles.line}>
          <Text style={[styles.title, unread && styles.unread]} numberOfLines={1}>
            {title}
          </Text>
          {muted && <MutedIcon color={theme.textMuted} size={14} />}
          <Text style={styles.time}>{when}</Text>
        </View>
        <View style={styles.line}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {unread && <View style={styles.dot} />}
        </View>
      </View>
    </Pressable>
  );
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 72,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    main: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    title: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    unread: {
      fontWeight: "700",
    },
    time: {
      marginLeft: "auto",
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    preview: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    previewUnread: {
      color: theme.text,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.accent,
    },
  });
}
