import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";
import MessageRow from "../Channel/MessageRow";

// The top of a thread, once nothing older is left to load: its root,
// ruled off, and how many replies it has.
export default function ThreadHead({
  root,
  myUserId,
  origin,
  token,
  onLongPress,
  onReact,
  target,
}: {
  root: Message;
  myUserId: string;
  origin: string;
  token: string;
  onLongPress: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  target?: "reply" | "edit";
}) {
  const styles = makeStyles(useTheme());
  const replyCount = root.thread?.replyCount ?? 0;
  return (
    <View>
      <View style={styles.root}>
        <MessageRow
          message={root}
          continued={false}
          myUserId={myUserId}
          origin={origin}
          token={token}
          onLongPress={onLongPress}
          onReact={onReact}
          target={target}
          withDay
        />
      </View>
      <View style={styles.rule} />
      <Text style={styles.count}>
        {replyCount === 0 ? "No replies yet" : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
      </Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: {
      paddingBottom: 12,
    },
    rule: {
      marginHorizontal: 16,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
    },
    count: {
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 4,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      fontWeight: "600",
    },
  });
}
