import { timestampDate } from "@bufbuild/protobuf/wkt";
import { mentionsMe } from "@stoop/core/mentions";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Avatar from "../../components/Avatar";
import { type Theme, tokens, useTheme } from "../../theme";
import MessageText from "./MessageText";

const AVATAR = 36;
const GAP = 10;

// One message: the author's face, name and time, unless it continues the
// one before (same author, same minute); its words; and a line per file,
// which opens nothing yet. A message that mentions the reader is tinted.
// A long press anywhere on it opens the message menu (MessageMenu),
// which draws the row again over the channel. A root deleted while its
// thread has replies stays as a placeholder, which no press opens.
// Replies, reactions, previews and threads come in later steps.
export default memo(function MessageRow({
  message,
  continued,
  myUserId,
  origin,
  token,
  onLongPress,
}: {
  message: Message;
  continued: boolean;
  myUserId: string;
  origin: string;
  token: string;
  onLongPress?: (message: Message) => void;
}) {
  const styles = makeStyles(useTheme());

  if (message.deleted) {
    return (
      <View style={[styles.row, styles.indent]}>
        <Text style={styles.placeholder}>Original message deleted</Text>
      </View>
    );
  }

  const author = message.author;
  const name = author ? author.displayName || author.username : "Someone";
  const created = message.createdAt ? timestampDate(message.createdAt) : undefined;
  const hold = onLongPress && (() => onLongPress(message));
  const body = (
    <>
      {message.content !== "" && (
        <MessageText content={message.content} myUserId={myUserId} edited={!!message.editedAt} onLongPress={hold} />
      )}
      {message.attachments.map((file) => (
        <Text key={file.fileId} style={styles.file} numberOfLines={1}>
          📎 {file.name}
        </Text>
      ))}
    </>
  );

  return (
    <Pressable
      onLongPress={hold}
      // Not one element: its name, time and words stay readable apart.
      accessible={false}
      style={({ pressed }) => [
        styles.row,
        mentionsMe(message, myUserId) && styles.mentioned,
        pressed && !!hold && styles.pressed,
      ]}
    >
      {continued ? (
        <View style={styles.indent}>{body}</View>
      ) : (
        <View style={styles.lead}>
          <Avatar name={name} fileId={author?.avatarFileId ?? ""} origin={origin} token={token} size={AVATAR} />
          <View style={styles.main}>
            <View style={styles.byline}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
                {author?.deleted && <Text style={styles.muted}> (deleted)</Text>}
              </Text>
              {created && (
                <Text style={styles.time}>
                  {created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </Text>
              )}
            </View>
            {body}
          </View>
        </View>
      )}
    </Pressable>
  );
});

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      marginHorizontal: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: tokens.radiusMd,
    },
    mentioned: {
      backgroundColor: theme.accentSoft,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    lead: {
      flexDirection: "row",
      gap: GAP,
      paddingTop: 8,
    },
    indent: {
      paddingLeft: AVATAR + GAP,
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
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    file: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    placeholder: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      fontStyle: "italic",
    },
  });
}
