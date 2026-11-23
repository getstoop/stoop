import { timestampDate } from "@bufbuild/protobuf/wkt";
import { type SystemGlyph, type SystemPart, systemLine, systemText } from "@stoop/core/systemMessages";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { memo, useState } from "react";
import {
  type AccessibilityActionEvent,
  type ColorValue,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { type Theme, tokens, useTheme } from "../../theme";
import { messageTime } from "./messageTime";

// The glyph's column, as wide as a message's avatar and its gap
// (MessageRow), so the two line up.
const COLUMN = 36;
const GAP = 10;
// One line of the sentence, at the system's default text size.
const LINE = 18;
// The screen reader's way to the menu a long press opens.
const MENU_ACTION = { name: "longpress", label: "Delete" };
// The screen reader's way to unfold a long list of people, and to fold it.
const UNFOLD_ACTION = { name: "activate", label: "Show everyone" };
const FOLD_ACTION = { name: "activate", label: "Show fewer" };

// A system message (docs/architecture/messaging.md → System messages):
// a row that records something that happened in the channel, in the
// words core/systemMessages gives both apps. A glyph for its kind in the
// avatar column, the sentence in muted text with the people it names in
// full ink (a deleted account marked as a message's author is), the new
// name of a renamed channel drawn the same, and the time in a column of
// its own on the right, on the first line, so a sentence that wraps
// never strands it. No avatar, reactions or thread. Names are plain
// text, as mobile has no user card, and a pin's excerpt is words, for
// now. A long list's "3 others" unfolds to every name when tapped, and
// "Show fewer" after them folds it again. To a screen reader it is one
// element, the sentence as it now reads and the time, whose activate
// action unfolds or folds the list. A long press opens its menu
// (onLongPress), which the screen gives only to someone who may
// moderate messages (SystemMenu); everyone else gets nothing. A screen
// reader is offered the same menu as the row's one action, Delete, with
// a hint saying so. The glyph's box is one line of the sentence tall at
// the system's text size, so it stays centred on the first line however
// large the reader's text is. On a
// menu's card (`card`) it is drawn again with the time's day.
export default memo(function SystemRow({
  message,
  onLongPress,
  card = false,
}: {
  message: Message;
  onLongPress?: (message: Message) => void;
  card?: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { fontScale } = useWindowDimensions();
  const [unfolded, setUnfolded] = useState(false);
  const line = systemLine(message, unfolded);
  if (!line) return null;
  const created = message.createdAt ? timestampDate(message.createdAt) : undefined;
  const time = created ? messageTime(created, card) : "";
  const hold = onLongPress && (() => onLongPress(message));
  const toggle = line.fold && (() => setUnfolded((was) => !was));
  const actions = [
    ...(toggle ? [unfolded ? FOLD_ACTION : UNFOLD_ACTION] : []),
    ...(hold ? [MENU_ACTION] : []),
  ];
  const act = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "activate") toggle?.();
    if (event.nativeEvent.actionName === "longpress") hold?.();
  };
  return (
    <Pressable
      onLongPress={hold}
      accessible
      accessibilityLabel={time ? `${systemText(line.parts)}, ${time}` : systemText(line.parts)}
      accessibilityHint={
        [toggle && (unfolded ? "Shows fewer people" : "Shows everyone added"), hold && "Has a Delete action"]
          .filter(Boolean)
          .join(". ") || undefined
      }
      accessibilityState={toggle ? { expanded: unfolded } : undefined}
      accessibilityActions={actions.length > 0 ? actions : undefined}
      onAccessibilityAction={actions.length > 0 ? act : undefined}
      style={({ pressed }) => [card ? styles.card : styles.row, pressed && !!hold && styles.pressed]}
    >
      <View style={[styles.glyph, { height: LINE * fontScale }]}>
        <Glyph glyph={line.glyph} color={theme.textMuted} />
      </View>
      <Text style={styles.sentence}>
        {line.parts.map((part, index) => (
          // Keyed by place: a row's parts never reorder.
          <Part key={index} part={part} styles={styles} onUnfold={toggle} onHold={hold} />
        ))}
        {toggle && unfolded && (
          <>
            {" "}
            <Text style={styles.fold} onPress={toggle} onLongPress={hold}>
              Show fewer
            </Text>
          </>
        )}
      </Text>
      {time !== "" && <Text style={styles.time}>{time}</Text>}
    </Pressable>
  );
});

type Styles = ReturnType<typeof makeStyles>;

function Part({
  part,
  styles,
  onUnfold,
  onHold,
}: {
  part: SystemPart;
  styles: Styles;
  onUnfold?: () => void;
  onHold?: () => void;
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
      // A long press on it still opens the row's menu.
      return (
        <Text style={styles.strong} onPress={onUnfold} onLongPress={onHold}>
          {part.label}
        </Text>
      );
    case "channel":
      return part.current ? <Text style={styles.strong}>#{part.name}</Text> : `#${part.name}`;
    case "excerpt":
      return part.deleted ? <Text style={styles.deleted}>{part.text}</Text> : part.text;
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
    // "Show fewer", after an unfolded list: muted and underlined, as web's.
    fold: {
      color: theme.textMuted,
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
