import { ActivityKind } from "@stoop/gen/stoop/chat/v1/activity_pb";
import { StyleSheet, Text, View } from "react-native";
import { BubbleGlyph, MailGlyph, ReplyGlyph } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// What happened, on the corner of the avatar of who did it: @ for a
// mention, an arrow for a reply, a bubble for a thread, an envelope for
// a direct message. Badge red while unread, quiet once read; the ring is
// the row's own background, so it reads as cut out of the avatar.
// Decorative: the row's label says the kind in its verb.
export default function KindGlyph({ kind, unread, ring }: { kind: ActivityKind; unread: boolean; ring: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const color = unread ? theme.onAccent : theme.textMuted;
  return (
    <View
      style={[styles.glyph, { borderColor: ring }, unread && styles.unread]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {kind === ActivityKind.REPLY ? (
        <ReplyGlyph color={color} />
      ) : kind === ActivityKind.DM ? (
        <MailGlyph color={color} />
      ) : kind === ActivityKind.THREAD_REPLY ? (
        <BubbleGlyph color={color} />
      ) : (
        <Text style={[styles.at, { color }]}>@</Text>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    glyph: {
      position: "absolute",
      right: -4,
      bottom: -4,
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    unread: {
      backgroundColor: theme.danger,
    },
    at: {
      fontSize: tokens.textXs,
      fontWeight: "700",
      includeFontPadding: false,
    },
  });
}
