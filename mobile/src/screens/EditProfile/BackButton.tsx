import { Pressable, StyleSheet } from "react-native";
import { BackIcon } from "../../components/Icons";
import { useTheme } from "../../theme";

// Back in Android's header; iOS has its own bar button (backItem).
export default function BackButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <BackIcon color={theme.text} size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.7,
  },
});
