import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// The chips under a message's words, one per emoji it has, as the mockup
// and web's ReactionBar draw them: the emoji and how many, filled and
// ringed in the accent when the reader is among them, wrapping to more
// lines when there are many. A tap toggles the reader's own reaction
// with that emoji (onReact, the same path as the menu's); a long press
// is the row's (onLongPress), since a touch on a chip never reaches the
// row. No chips, no row. Who reacted isn't said: the app has no member
// list to name them from yet.
export default function Reactions({
  message,
  myUserId,
  onReact,
  onLongPress,
}: {
  message: Message;
  myUserId: string;
  onReact: (message: Message, emoji: string) => void;
  onLongPress?: () => void;
}) {
  const styles = makeStyles(useTheme());
  if (message.reactions.length === 0) return null;
  return (
    <View style={styles.row}>
      {message.reactions.map((group) => {
        const mine = group.userIds.includes(myUserId);
        const count = group.userIds.length;
        const label = `${group.emoji} ${count} ${count === 1 ? "reaction" : "reactions"}`;
        return (
          <Pressable
            key={group.emoji}
            accessibilityRole="button"
            accessibilityLabel={mine ? `${label}, including yours` : label}
            accessibilityState={{ selected: mine }}
            onPress={() => onReact(message, group.emoji)}
            onLongPress={onLongPress}
            style={({ pressed }) => [styles.chip, mine && styles.mine, pressed && styles.down]}
          >
            <Text style={styles.emoji}>{group.emoji}</Text>
            <Text style={styles.count}>{count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 4,
    },
    // The border is always there, in the chip's own fill on another's, so
    // a chip keeps its size as the reader's own reaction comes and goes.
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: 28,
      paddingHorizontal: 10,
      borderRadius: tokens.radiusPill,
      borderWidth: 1,
      borderColor: theme.raised,
      backgroundColor: theme.raised,
    },
    mine: {
      borderColor: theme.accent,
      backgroundColor: theme.accentSoft,
    },
    // As the menu's quick reactions take a press.
    down: {
      opacity: 0.85,
    },
    emoji: {
      fontSize: tokens.textUi,
    },
    count: {
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "700",
    },
  });
}
