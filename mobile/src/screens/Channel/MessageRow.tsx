import { timestampDate } from "@bufbuild/protobuf/wkt";
import { dayAndTime, sameDay } from "@stoop/core/dates";
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
// which opens nothing yet. A reply says whom it answers and the first
// words of that message over its byline, as the mockup draws it (the
// server's preview; a quoted message since deleted reads as such). A
// message that mentions the reader is tinted; the one the reader is
// quoting in the composer (`target`) is ringed in the accent on the
// panel surface, over the tint when it has one. A long press anywhere
// on it opens the message menu (MessageMenu), which draws the row again
// as a card: the mockup's 12px inset, no tint or ring, and the day with
// the time, since the list's day lines are not there to carry it. A
// root deleted while its thread has replies stays as a placeholder,
// which no press opens. Reactions, previews and threads come in later
// steps.
export default memo(function MessageRow({
  message,
  continued,
  myUserId,
  origin,
  token,
  onLongPress,
  card = false,
  target = false,
}: {
  message: Message;
  continued: boolean;
  myUserId: string;
  origin: string;
  token: string;
  onLongPress?: (message: Message) => void;
  card?: boolean;
  target?: boolean;
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
  const mentioned = !card && mentionsMe(message, myUserId);
  const ringed = !card && target;
  const quoted = message.replyTo;
  const quotedName = quoted?.author ? quoted.author.displayName || quoted.author.username : "";
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
      testID={ringed ? "reply-target" : undefined}
      style={({ pressed }) => [
        card ? styles.card : styles.row,
        mentioned && styles.mentioned,
        ringed && !mentioned && styles.targetSurface,
        ringed && styles.ring,
        pressed && !!hold && styles.pressed,
      ]}
    >
      {continued ? (
        <View style={styles.indent}>{body}</View>
      ) : (
        <View style={styles.lead}>
          <Avatar name={name} fileId={author?.avatarFileId ?? ""} origin={origin} token={token} size={AVATAR} />
          <View style={styles.main}>
            {quoted && (
              <Text style={styles.quote} numberOfLines={1}>
                {quotedName || quoted.preview ? (
                  <>
                    ↳ Replying to <Text style={styles.quotedName}>{quotedName || "deleted"}</Text>:{" "}
                    {quoted.preview || "(message deleted)"}
                  </>
                ) : (
                  "↳ Replying to a deleted message"
                )}
              </Text>
            )}
            <View style={styles.byline}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
                {author?.deleted && <Text style={styles.muted}> (deleted)</Text>}
              </Text>
              {created && <Text style={styles.time}>{when(created, card)}</Text>}
            </View>
            {body}
          </View>
        </View>
      )}
    </Pressable>
  );
});

// The time, as the list shows it under its day lines; on the card the
// day too, as web's thread shows a reply's.
function when(created: Date, card: boolean): string {
  if (!card || sameDay(created, new Date())) {
    return created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return dayAndTime(created);
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      marginHorizontal: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: tokens.radiusMd,
    },
    // The lead's own 8px top makes the mockup's 12 all round.
    card: {
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 12,
    },
    mentioned: {
      backgroundColor: theme.accentSoft,
    },
    targetSurface: {
      backgroundColor: theme.panel,
    },
    // Inset, so the row's words don't move when the ring comes and goes.
    ring: {
      boxShadow: `inset 0 0 0 1.5px ${theme.accent}`,
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
    quote: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    quotedName: {
      fontWeight: "700",
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
