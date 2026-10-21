import { StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A line across the list with a label: the day above its first message,
// or, in the accent colour, where the messages that are new start.
export default function Divider({ label, fresh }: { label: string; fresh: boolean }) {
  const styles = makeStyles(useTheme(), fresh);
  return (
    <View
      style={styles.divider}
      accessible
      accessibilityRole="header"
      accessibilityLabel={fresh ? `${label} messages` : label}
    >
      <View style={styles.rule} />
      <Text style={styles.label}>{label}</Text>
      {!fresh && <View style={styles.rule} />}
    </View>
  );
}

function makeStyles(theme: Theme, fresh: boolean) {
  const color = fresh ? theme.accent : theme.textMuted;
  return StyleSheet.create({
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginVertical: 10,
    },
    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: fresh ? theme.accent : theme.border,
    },
    label: {
      color,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
  });
}
