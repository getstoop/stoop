import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { memo } from "react";
import { type AccessibilityActionEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { authorName } from "../../api/authors";
import { type Theme, tokens, useTheme } from "../../theme";
import { messageTime } from "./messageTime";

// The bell's column, as wide as a message's avatar and its gap
// (MessageRow), so the two line up.
const COLUMN = 36;
const GAP = 10;
// The head line's height at the system's default text size, which the
// bell is centred on.
const HEAD = 20;
// The screen reader's way to the menu a long press opens.
const MENU_ACTION = { name: "longpress", label: "Reminder actions" };

// A delivered reminder (docs/architecture/messaging.md → Reminders), a
// system row with a look of its own so it is seen, as web's ReminderRow:
// a bare bell in the accent where an avatar goes, "Reminder from" and
// the name of who set it, and the time on the head line, and the text
// under it at a message's size in full ink, as plain text exactly as
// typed: no Markdown, no mention, and a link is not made one. It never
// runs on from the rows round it (core/grouping). A long press opens its
// menu (ReminderMenu: Copy text, and Delete for whoever may); a screen
// reader hears it as one element, with that menu as an action. On the
// menu's card (`card`) it is drawn again with the time's day.
export default memo(function ReminderRow({
  message,
  flashed = false,
  onLongPress,
  card = false,
}: {
  message: Message;
  // A jump landed on it.
  flashed?: boolean;
  onLongPress?: (message: Message) => void;
  card?: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { fontScale } = useWindowDimensions();
  const name = authorName(message.author);
  const created = message.createdAt ? timestampDate(message.createdAt) : undefined;
  const time = created ? messageTime(created, card) : "";
  const hold = onLongPress && (() => onLongPress(message));
  return (
    <Pressable
      onLongPress={hold}
      accessible
      accessibilityLabel={[`Reminder from ${name}`, time, message.content].filter(Boolean).join(", ")}
      accessibilityHint={hold ? `Has a ${MENU_ACTION.label} action` : undefined}
      accessibilityActions={hold ? [MENU_ACTION] : undefined}
      onAccessibilityAction={(event: AccessibilityActionEvent) => {
        if (event.nativeEvent.actionName === "longpress") hold?.();
      }}
      testID={flashed ? "focus-target" : `reminder-${message.id}`}
      style={({ pressed }) => [
        card ? styles.card : styles.row,
        flashed && !card && styles.flashed,
        pressed && !!hold && styles.pressed,
      ]}
    >
      <View style={[styles.bell, { height: HEAD * fontScale }]}>
        <BellGlyph color={theme.accent} />
      </View>
      <View style={styles.main}>
        <View style={styles.head}>
          <Text style={styles.from} numberOfLines={2}>
            <Text style={styles.strong}>Reminder</Text> from <Text style={styles.strong}>{name}</Text>
            {message.author?.deleted && <Text style={styles.mark}> (deleted)</Text>}
          </Text>
          {time !== "" && <Text style={styles.time}>{time}</Text>}
        </View>
        <Text style={styles.text} selectable={false}>
          {message.content}
        </Text>
      </View>
    </Pressable>
  );
});

// The system row's bell (SystemRow), at an avatar's mark's size.
function BellGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 17v-6a6 6 0 0 1 12 0v6l2 2H4l2-2M10 21h4" />
    </Svg>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // A message row's insets, so the bell sits where its avatar does.
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginHorizontal: 8,
      paddingHorizontal: 8,
      paddingTop: 11,
      paddingBottom: 3,
      borderRadius: tokens.radiusMd,
    },
    // The menu's card: a message card's 12 all round.
    card: {
      flexDirection: "row",
      alignItems: "flex-start",
      padding: 12,
    },
    flashed: {
      backgroundColor: theme.panel,
      boxShadow: `inset 0 0 0 1.5px ${theme.accent}`,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    bell: {
      width: COLUMN,
      marginRight: GAP,
      alignItems: "center",
      justifyContent: "center",
    },
    main: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    head: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
      minHeight: HEAD,
    },
    from: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    strong: {
      color: theme.text,
      fontWeight: "600",
    },
    // As a message's author marks a deleted account.
    mark: {
      fontSize: tokens.textSm,
    },
    time: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    text: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
