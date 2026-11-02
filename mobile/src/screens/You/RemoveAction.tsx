import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { type SharedValue, useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { TrashIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";

export const ACTION_WIDTH = 88;

// The Remove drawn under a server's row. A screen reader is kept from it
// until the row has moved aside, read from where the row is rather than
// its open and close events; the row has it among its own actions instead.
export default function RemoveAction({
  name,
  translation,
  onPress,
}: {
  name: string;
  translation: SharedValue<number>;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [open, setOpen] = useState(false);
  useAnimatedReaction(
    () => translation.value < -ACTION_WIDTH / 2,
    (past, before) => {
      if (past !== before) scheduleOnRN(setOpen, past);
    },
  );
  return (
    <Pressable
      // Hidden, it has no name either: Android's view tree keeps a view
      // a screen reader is kept from, and Maestro reads that tree. A new
      // view each way, as Android kept the name on the old one once the
      // label was taken off.
      key={open ? "open" : "hidden"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      accessibilityRole="button"
      accessibilityLabel={open ? `Remove ${name}` : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <TrashIcon color={theme.danger} size={20} />
      <Text style={styles.label}>Remove</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    action: {
      width: ACTION_WIDTH,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    pressed: {
      opacity: 0.7,
    },
    label: {
      color: theme.danger,
      fontSize: tokens.textSm,
    },
  });
}
