import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, StyleSheet, Text } from "react-native";
import { MegaphoneIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "./Surface";

// Where the composer would be, for someone who can't post in an
// announcement channel, in web's words. On the composer's surface, since
// the list scrolls under it here.
export default function PostingClosed({ place }: { place: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <Surface glass={Platform.OS === "ios" && isLiquidGlassAvailable()} style={styles.card}>
      <MegaphoneIcon color={theme.textMuted} />
      <Text style={styles.words} testID="posting-closed">
        <Text style={styles.strong}>{place} is an announcement channel.</Text> Only admins post here; you can still
        react.
      </Text>
    </Surface>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: {
      marginHorizontal: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 24,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    words: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    strong: {
      color: theme.text,
      fontWeight: "600",
    },
  });
}
