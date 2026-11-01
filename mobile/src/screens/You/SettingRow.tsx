import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRightIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// A setting on the You tab: its name, its value and a chevron. With no
// onPress it only shows, until the screen it opens is built.
export default function SettingRow({
  label,
  value,
  divided,
  testID,
  onPress,
}: {
  label: string;
  value: string;
  // A line above it, for any row but a group's first.
  divided?: boolean;
  testID?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const content = (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      <ChevronRightIcon color={theme.textMuted} />
    </>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${label}, ${value}`} testID={testID} style={[styles.row, divided && styles.divided]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, divided && styles.divided, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 14,
    },
    divided: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    label: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    value: {
      color: theme.textMuted,
      fontSize: tokens.textBody,
    },
  });
}
