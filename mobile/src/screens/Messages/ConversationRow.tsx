import { timestampDate } from "@bufbuild/protobuf/wkt";
import { dmFaces, dmPreview, dmTime, dmTitle } from "@stoop/core/dms";
import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MutedIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import ConversationFaces from "./ConversationFaces";

// One conversation in the Messages tab: who it is with, when it last
// moved, and its newest message on one line. Unread, the name is bold
// and a dot ends the line, unless it is muted. Opens nothing yet: the
// conversation screen comes later, so it is drawn but is not a button.
export default memo(function ConversationRow({
  dm,
  meId,
  origin,
  token,
}: {
  dm: DirectMessage;
  meId: string;
  origin: string;
  token: string;
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
  const label = [title, muted && "muted", unread && "unread", when, preview].filter(Boolean).join(", ");

  return (
    <View style={styles.row} accessible accessibilityLabel={label} testID={`conversation-${channel?.id ?? ""}`}>
      <ConversationFaces faces={dmFaces(dm, meId)} origin={origin} token={token} />
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
    </View>
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
