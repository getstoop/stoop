import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet } from "react-native";
import { ArrowDownIcon } from "../../components/Icons";
import { tokens, useTheme } from "../../theme";
import Surface from "./Surface";

// A round button over the composer's right end that takes the reader
// back to the newest message: the composer's surface (Liquid Glass where
// iOS has it, else the panel) with an arrow pointing down. It fades in
// while the reader is away from the newest message and out once they
// are back, and takes no taps while it is out of sight.
export default function JumpToLatest({ shown, onPress }: { shown: boolean; onPress: () => void }) {
  const theme = useTheme();
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();
  const opacity = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: shown ? 1 : 0, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown, opacity]);
  return (
    <Animated.View style={{ opacity }} pointerEvents={shown ? "auto" : "none"}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Jump to the latest message"
        onPress={onPress}
        style={({ pressed }) => pressed && styles.down}
      >
        <Surface glass={glass} style={styles.round}>
          <ArrowDownIcon color={theme.text} size={22} />
        </Surface>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  round: {
    width: 44,
    height: 44,
    borderRadius: tokens.radiusPill,
    alignItems: "center",
    justifyContent: "center",
  },
  down: {
    opacity: 0.85,
  },
});
