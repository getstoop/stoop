import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { PaperclipIcon } from "../../components/Icons";
import { tokens, useTheme } from "../../theme";

// The pill's reminder, with the keyboard down, that files are held for
// the next message: a paperclip and how many, before the draft, as the
// attaching mockup draws it. The pill says it in words for a screen
// reader.
export default function AttachmentCount({ count, style }: { count: number; style: ViewStyle }) {
  const theme = useTheme();
  return (
    <View style={[styles.count, style]} testID="attachment-count">
      <PaperclipIcon color={theme.text} />
      <Text style={[styles.text, { color: theme.text }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  count: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: tokens.radiusPill,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
  },
});
