import { timestampDate } from "@bufbuild/protobuf/wkt";
import { sameDay } from "@stoop/core/dates";
import { plainText } from "@stoop/core/markdown/text";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { authorName } from "../../api/authors";
import Avatar from "../../components/Avatar";
import { PaperclipIcon } from "../../components/Icons";
import MessageBody from "../../components/MessageBody";
import { type Theme, tokens, useTheme } from "../../theme";

// The row's widths around the words are repeated in BODY_INSETS
// (components/MessageBody/insets.ts, `search`); a change here changes
// them there.
const AVATAR = 36;
const GAP = 10;

// One match, as web's ResultRow lays it out: the author's face, their
// name, "in #channel" and when, then the message's words as the channel
// draws them, and one muted line per file. The row is one button that
// opens the channel on the message. The matched words are not marked:
// the phone's MessageBody has no highlight yet.
export default memo(function ResultRow({
  message,
  channelName,
  myUserId,
  origin,
  token,
  onPress,
}: {
  message: Message;
  // The channel's name, or "…" for one the space's list doesn't hold.
  channelName: string;
  myUserId: string;
  origin: string;
  token: string;
  onPress: (message: Message) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const author = message.author;
  const name = authorName(author);
  const created = message.createdAt ? timestampDate(message.createdAt) : undefined;
  const date = created ? when(created) : "";
  const files = message.attachments.map((attachment) => attachment.name);
  const words = plainText(message.content) || files.join(", ");
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${name} in #${channelName}, ${date}: ${words}`}
      onPress={() => onPress(message)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Avatar name={name} fileId={author?.avatarFileId ?? ""} origin={origin} token={token} size={AVATAR} />
      <View style={styles.main}>
        <View style={styles.byline}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
            {author?.deleted && <Text style={styles.muted}> (deleted)</Text>}
            <Text style={styles.muted}> in #{channelName}</Text>
          </Text>
          <Text style={styles.time}>{date}</Text>
        </View>
        {message.content !== "" && (
          <MessageBody
            content={message.content}
            myUserId={myUserId}
            editedAt={message.editedAt}
            mentionsEntireChannel={message.mentionsEntireChannel}
            mentionsHere={message.mentionsHere}
            place="search"
          />
        )}
        {files.map((file, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two files may share a name
          <View key={index} style={styles.file}>
            <PaperclipIcon color={theme.textMuted} size={14} />
            <Text style={styles.fileName} numberOfLines={1}>
              {file}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
});

// The time today, otherwise the day, with the year once it isn't this
// year: "9:31 AM", "Oct 21", "Oct 21, 2025".
function when(created: Date): string {
  const now = new Date();
  if (sameDay(created, now)) return created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return created.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(created.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: GAP,
      marginHorizontal: 8,
      paddingHorizontal: 8,
      paddingVertical: 8,
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
    byline: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
    },
    name: {
      flexShrink: 1,
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "700",
    },
    muted: {
      color: theme.textMuted,
      fontWeight: "400",
    },
    time: {
      marginLeft: "auto",
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    file: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 2,
    },
    fileName: {
      flexShrink: 1,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
