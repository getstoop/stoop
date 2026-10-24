import { Pressable, StyleSheet, Text, View } from "react-native";
import { CheckIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

const BOX = 18;

// The thread composer's line over its field: a checkbox, "Also send to
// #channel", the whole line one control, so the label toggles it too.
export default function AlsoSendRow({
  channelName,
  checked,
  onChange,
}: {
  channelName: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      testID="also-send"
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.checked]}>
        {checked && <CheckIcon color={theme.onAccent} size={14} />}
      </View>
      <Text style={styles.label}>Also send to #{channelName}</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 8,
      minHeight: 32,
      paddingHorizontal: 10,
      borderRadius: tokens.radiusMd,
    },
    pressed: {
      opacity: 0.85,
    },
    box: {
      width: BOX,
      height: BOX,
      borderRadius: tokens.radiusSm,
      borderWidth: 1.5,
      borderColor: theme.textMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    checked: {
      borderColor: theme.accent,
      backgroundColor: theme.accent,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
