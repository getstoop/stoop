import { Pressable, StyleSheet, Text, View } from "react-native";
import { CheckIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

// "People can choose", directly under a poll form's question (PollForm,
// TimePollForm): one of the poll's `noun` or several, two halves of one
// control, the chosen one raised and ticked. A screen reader hears a
// radio group.
export default function PollChoice({
  noun,
  multiple,
  disabled,
  onChange,
}: {
  // "option" on a poll, "time" on a time poll: "One option", "Several times".
  noun: "option" | "time";
  multiple: boolean;
  disabled: boolean;
  onChange: (multiple: boolean) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>People can choose</Text>
      <View style={styles.choice} accessibilityRole="radiogroup" accessibilityLabel="People can choose">
        <Half
          label={`One ${noun}`}
          on={!multiple}
          onPress={() => onChange(false)}
          disabled={disabled}
          styles={styles}
          theme={theme}
        />
        <Half
          label={`Several ${noun}s`}
          on={multiple}
          onPress={() => onChange(true)}
          disabled={disabled}
          styles={styles}
          theme={theme}
        />
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// One half, the chosen one raised and ticked.
function Half({
  label,
  on,
  onPress,
  disabled,
  styles,
  theme,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  disabled: boolean;
  styles: Styles;
  theme: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.half, on && styles.halfOn]}
    >
      {on && <CheckIcon color={theme.text} size={14} />}
      <Text style={[styles.halfText, on && styles.halfTextOn]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    field: {
      gap: 6,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    choice: {
      flexDirection: "row",
      padding: 2,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    half: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: tokens.radius,
    },
    halfOn: {
      backgroundColor: theme.raised,
    },
    halfText: {
      color: theme.textMuted,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    halfTextOn: {
      color: theme.text,
    },
  });
}
