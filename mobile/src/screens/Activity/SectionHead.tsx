import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A section's heading on the Activity tab: the word, and on New its
// count and the chip that reads everything.
export default function SectionHead({
  title,
  count,
  onMarkAll,
}: {
  title: string;
  count?: number;
  onMarkAll?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={[styles.head, onMarkAll ? styles.withChip : styles.plain]}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
        {count !== undefined && <Text style={styles.count}> {count}</Text>}
      </Text>
      {onMarkAll && (
        // The chip is drawn small; the press covers the heading's full
        // height, so the target is 44pt tall.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark all read"
          onPress={onMarkAll}
          style={styles.chipTarget}
        >
          {({ pressed }) => (
            <View style={[styles.chip, pressed && styles.chipPressed]}>
              <Text style={styles.chipLabel}>Mark all read</Text>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 8,
    },
    withChip: {
      minHeight: 44,
    },
    plain: {
      marginBottom: 4,
    },
    title: {
      flex: 1,
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
    count: {
      color: theme.text,
      fontVariant: ["tabular-nums"],
    },
    chipTarget: {
      height: 44,
      paddingLeft: 8,
      justifyContent: "center",
    },
    chip: {
      height: 30,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusPill,
      borderWidth: 1,
      borderColor: theme.border,
      justifyContent: "center",
    },
    chipPressed: {
      backgroundColor: theme.hover,
    },
    chipLabel: {
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
  });
}
