import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// One field of the profile: its label, with how much of its limit is used
// when counted, the input, and a note under it, which a refusal replaces.
export default function Field({
  label,
  value,
  maxLength,
  counted,
  note,
  error,
  locked,
  multiline,
  ...input
}: {
  label: string;
  value: string;
  counted?: boolean;
  note?: string;
  error?: string;
  // Showing what it holds, and not to be changed.
  locked?: boolean;
} & TextInputProps) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const under = error ?? note;

  return (
    <View style={styles.field}>
      <View style={styles.top}>
        <Text style={styles.label}>{label}</Text>
        {counted && (
          <Text style={styles.count}>
            {value.length} / {maxLength}
          </Text>
        )}
      </View>
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityState={{ disabled: locked }}
        value={value}
        maxLength={maxLength}
        multiline={multiline}
        editable={!locked}
        placeholderTextColor={theme.textMuted}
        style={[styles.input, multiline && styles.multiline, locked && styles.locked, error ? styles.refused : null]}
      />
      {under ? (
        <Text style={[styles.note, error ? styles.error : null]} accessibilityRole={error ? "alert" : undefined}>
          {under}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    field: {
      gap: 6,
    },
    top: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginHorizontal: 4,
    },
    label: {
      color: theme.text,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    count: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    input: {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: tokens.radiusMd,
      backgroundColor: theme.panel,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    multiline: {
      minHeight: 88,
      lineHeight: tokens.textBody * tokens.leadingBody,
      textAlignVertical: "top",
    },
    locked: {
      backgroundColor: theme.raised,
      color: theme.textMuted,
    },
    refused: {
      borderColor: theme.danger,
    },
    note: {
      marginHorizontal: 4,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: tokens.textSm * tokens.leadingUi,
    },
    error: {
      color: theme.danger,
    },
  });
}
