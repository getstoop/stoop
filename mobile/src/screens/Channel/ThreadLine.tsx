import { timestampDate } from "@bufbuild/protobuf/wkt";
import { shortDateTime } from "@stoop/core/dates";
import type { ThreadSummary } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { authorName } from "../../api/authors";
import Avatar from "../../components/Avatar";
import { type Theme, tokens, useTheme } from "../../theme";

const FACE = 22;

// The line under a root that has replies, as the server summarises them:
// the two who replied last, how many replies, how many are new to the
// reader, and when the last came. One press opens the thread.
export default function ThreadLine({
  thread,
  origin,
  token,
  onPress,
}: {
  thread: ThreadSummary;
  origin: string;
  token: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const count = `${thread.replyCount} ${thread.replyCount === 1 ? "reply" : "replies"}`;
  const unread = thread.unreadCount;
  const last = thread.lastReplyAt ? timestampDate(thread.lastReplyAt) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count}${unread > 0 ? `, ${unread} new` : ""}, open the thread`}
      onPress={onPress}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}
    >
      <View style={styles.faces}>
        {thread.recentAuthors.slice(0, 2).map((author, index) => (
          <Avatar
            key={author.id}
            name={authorName(author)}
            fileId={author.avatarFileId}
            origin={origin}
            token={token}
            size={FACE}
            style={[styles.face, index > 0 && styles.overlap]}
          />
        ))}
      </View>
      <Text style={styles.count}>{count}</Text>
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread} new</Text>
        </View>
      )}
      {last && (
        <Text style={styles.last} numberOfLines={1}>
          Last reply {shortDateTime(last)}
        </Text>
      )}
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 40,
      marginTop: 4,
      marginLeft: -8,
      paddingHorizontal: 8,
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.panel,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    faces: {
      flexDirection: "row",
    },
    // Ringed in the line's own surface, so the second sits cut into the first.
    face: {
      borderWidth: 2,
      borderColor: theme.panel,
    },
    overlap: {
      marginLeft: -6,
    },
    count: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
    badge: {
      height: 18,
      paddingHorizontal: 6,
      justifyContent: "center",
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.accent,
    },
    badgeText: {
      color: theme.onAccent,
      fontSize: tokens.textXs,
      fontWeight: "700",
    },
    last: {
      flex: 1,
      textAlign: "right",
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
