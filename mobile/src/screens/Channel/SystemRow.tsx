import { timestampDate } from "@bufbuild/protobuf/wkt";
import { type SystemGlyph, type SystemPart, systemLine, systemText } from "@stoop/core/systemMessages";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { memo } from "react";
import { type ColorValue, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type Theme, tokens, useTheme } from "../../theme";
import { messageTime } from "./messageTime";

// The glyph's column, as wide as a message's avatar and its gap
// (MessageRow), so the two line up.
const COLUMN = 36;
const GAP = 10;
// One line of the sentence, at the system's default text size.
const LINE = 18;
// The screen reader's ways to the menu a long press opens and to a pin
// row's message.
const MENU_ACTION = { name: "longpress", label: "Delete" };
const VIEW_ACTION = { name: "view", label: "View message" };

// A system message (docs/architecture/messaging.md → System messages):
// a row that records something that happened in the channel, in the
// words core/systemMessages gives both apps. A glyph for its kind in the
// avatar column, the sentence in muted text with the people it names in
// full ink (a deleted account marked as a message's author is), the new
// name of a renamed channel drawn the same, and the time in a column of
// its own on the right, on the first line, so a sentence that wraps
// never strands it. No avatar, reactions or thread. Names are plain
// text, as mobile has no user card; "3 others" is its label alone. A
// pin's excerpt, and the View after it, go to the pinned message
// (onJumpTo); not once it has been deleted. To a screen reader it is one
// element, the sentence and the time. A long press opens its menu
// (onLongPress), which the screen gives only to someone who may
// moderate messages (SystemMenu); everyone else gets nothing. A screen
// reader is offered the menu as an action, Delete, and the jump as
// another, View message, with a hint naming them. The glyph's box is one line of the sentence tall at
// the system's text size, so it stays centred on the first line however
// large the reader's text is. On a
// menu's card (`card`) it is drawn again with the time's day.
export default memo(function SystemRow({
  message,
  onLongPress,
  onJumpTo,
  card = false,
}: {
  message: Message;
  onLongPress?: (message: Message) => void;
  // Goes to the message the row is about (a pin's).
  onJumpTo?: (messageId: string) => void;
  card?: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { fontScale } = useWindowDimensions();
  const line = systemLine(message);
  if (!line) return null;
  const created = message.createdAt ? timestampDate(message.createdAt) : undefined;
  const time = created ? messageTime(created, card) : "";
  const hold = onLongPress && (() => onLongPress(message));
  const target = card || !onJumpTo ? "" : jumpTarget(line.parts);
  const view = target ? () => onJumpTo?.(target) : undefined;
  const actions = [...(view ? [VIEW_ACTION] : []), ...(hold ? [MENU_ACTION] : [])];
  return (
    <Pressable
      onLongPress={hold}
      accessible
      accessibilityLabel={time ? `${systemText(line.parts)}, ${time}` : systemText(line.parts)}
      accessibilityHint={actions.length > 0 ? `Has ${actions.map((action) => action.label).join(" and ")} actions` : undefined}
      accessibilityActions={actions.length > 0 ? actions : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") hold?.();
        else if (event.nativeEvent.actionName === "view") view?.();
      }}
      style={({ pressed }) => [card ? styles.card : styles.row, pressed && !!hold && styles.pressed]}
    >
      <View style={[styles.glyph, { height: LINE * fontScale }]}>
        <Glyph glyph={line.glyph} color={theme.textMuted} />
      </View>
      <Text style={styles.sentence}>
        {line.parts.map((part, index) => (
          // Keyed by place: a row's parts never reorder.
          <Part key={index} part={part} styles={styles} onView={view} onLongPress={hold} />
        ))}
      </Text>
      {time !== "" && <Text style={styles.time}>{time}</Text>}
    </Pressable>
  );
});

type Styles = ReturnType<typeof makeStyles>;

// The message a pin row's excerpt goes to: "" when there is none, or it
// has been deleted.
function jumpTarget(parts: SystemPart[]): string {
  for (const part of parts) {
    if (part.kind === "excerpt" && !part.deleted) return part.messageId;
  }
  return "";
}

function Part({
  part,
  styles,
  onView,
  onLongPress,
}: {
  part: SystemPart;
  styles: Styles;
  onView?: () => void;
  onLongPress?: () => void;
}) {
  switch (part.kind) {
    case "text":
      return part.text;
    case "person":
      return (
        <>
          <Text style={styles.strong}>{part.person.displayName || part.person.username || "Someone"}</Text>
          {part.person.deleted && <Text style={styles.mark}> (deleted)</Text>}
        </>
      );
    case "others":
      return <Text style={styles.strong}>{part.label}</Text>;
    case "channel":
      return part.current ? <Text style={styles.strong}>#{part.name}</Text> : `#${part.name}`;
    case "excerpt":
      if (part.deleted) return <Text style={styles.deleted}>{part.text}</Text>;
      if (!onView) return part.text;
      // The excerpt and View go to the message; a long press on them still
      // opens the row's menu.
      return (
        <Text onPress={onView} onLongPress={onLongPress}>
          {part.text} <Text style={styles.view}>View</Text>
        </Text>
      );
  }
}

// The glyph for each kind, from the paths web's row draws, at 16 points.
const GLYPH_PATHS: Record<SystemGlyph, string> = {
  "person-plus":
    "M15 20v-1a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6",
  "arrow-in": "M5 12h12M12 6l6 6-6 6",
  "arrow-out": "M19 12H7M12 6l-6 6 6 6",
  pencil: "M4 20h4L19 9l-4-4L4 16v4M13 7l4 4",
  "text-lines": "M4 7h16M4 12h16M4 17h10",
  pin: "M9 4h6l-1 6 3 3H7l3-3-1-6M12 13v7",
  megaphone: "M3 11v2l11 5V6L3 11M14 9h3a3 3 0 0 1 0 6h-3M6 14v4h3v-3",
  update: "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
};

function Glyph({ glyph, color }: { glyph: SystemGlyph; color: ColorValue }) {
  return (
    <Svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={GLYPH_PATHS[glyph]} />
    </Svg>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // A message row's insets, so the glyph sits where its avatar does.
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginHorizontal: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: tokens.radiusMd,
    },
    // The menu's card: a message card's 12 all round.
    card: {
      flexDirection: "row",
      alignItems: "flex-start",
      padding: 12,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    glyph: {
      width: COLUMN,
      marginRight: GAP,
      alignItems: "center",
      justifyContent: "center",
    },
    sentence: {
      flex: 1,
      minWidth: 0,
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: LINE,
    },
    strong: {
      color: theme.text,
      fontWeight: "600",
    },
    // As a message's author marks a deleted account.
    mark: {
      color: theme.textMuted,
      fontWeight: "400",
      fontSize: tokens.textSm,
    },
    deleted: {
      fontStyle: "italic",
    },
    // The way to a pin's message, after its excerpt: muted and underlined,
    // as on web.
    view: {
      fontSize: tokens.textSm,
      textDecorationLine: "underline",
    },
    time: {
      marginLeft: 8,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: LINE,
      textAlign: "right",
    },
  });
}
