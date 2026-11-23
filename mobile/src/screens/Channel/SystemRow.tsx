import { systemLine, systemText } from "@stoop/core/systemMessages";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { StyleSheet, Text } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A system message (the channel renamed, its topic set), for now as one
// plain muted line of the shared wording: no glyph, no live names and no
// menu. The row the design draws comes next.
export default function SystemRow({ message }: { message: Message }) {
  const styles = makeStyles(useTheme());
  const line = systemLine(message);
  if (!line) return null;
  return <Text style={styles.line}>{systemText(line.parts)}</Text>;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    line: {
      marginHorizontal: 16,
      marginVertical: 4,
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
