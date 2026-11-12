import type { ReactNode } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// A setting that is on or off: its name, a line under it when there is
// one to say, and the system's switch. A note stands in for the switch
// when there is nothing to set, and a leading element goes before the name.
export default function SwitchRow({
  label,
  detail,
  strong,
  value,
  divided,
  leading,
  note,
  disabled,
  testID,
  onValueChange,
}: {
  label: string;
  detail?: string;
  // A card's own heading, as do not disturb is.
  strong?: boolean;
  value: boolean;
  // A line above it, for any row but a group's first.
  divided?: boolean;
  leading?: ReactNode;
  note?: string;
  // Shown as it is, but not to be changed.
  disabled?: boolean;
  testID?: string;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={[styles.row, divided && styles.divided]}>
      {leading}
      {/* The switch says both lines, so a screen reader hears the row once. */}
      <View
        style={styles.text}
        accessibilityElementsHidden={note === undefined}
        importantForAccessibility={note === undefined ? "no-hide-descendants" : "auto"}
      >
        <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
        {detail !== undefined && <Text style={styles.detail}>{detail}</Text>}
      </View>
      {note !== undefined ? (
        <Text style={styles.note}>{note}</Text>
      ) : (
        <Switch
          accessibilityLabel={detail === undefined ? label : `${label}, ${detail}`}
          testID={testID}
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
          trackColor={{ false: theme.raised, true: theme.accent }}
          ios_backgroundColor={theme.raised}
          thumbColor={theme.onAccent}
        />
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    divided: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    label: {
      color: theme.text,
      fontSize: tokens.textBody,
    },
    strong: {
      fontWeight: "600",
    },
    note: {
      color: theme.warn,
      fontSize: tokens.textUi,
    },
    detail: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
