import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Theme, tokens, useTheme } from "../../theme";
import Surface from "../Channel/Surface";

const JOIN = 52;
// The bubble's padding around Join, and its corner, which follows
// Join's own.
const BUBBLE_PAD = 12;

// The foot of the Stage: who is here, in a line, over Join. Where iOS
// has Liquid Glass it is a bubble of it floating over the tiles, as the
// composer floats over a channel; elsewhere a solid band across the
// bottom. `onHeight` says how much of the screen's foot it covers, for
// the tiles to clear.
export default function StageFoot({ line, onHeight }: { line: string; onHeight: (height: number) => void }) {
  const styles = makeStyles(useTheme());
  const insets = useSafeAreaInsets();
  const glass = Platform.OS === "ios" && isLiquidGlassAvailable();

  const inside = (
    <>
      {!!line && (
        <Text style={styles.here} numberOfLines={2}>
          {line}
        </Text>
      )}
      {/* Inert until the app can join a call (STOOPMOBIL-48): disabled,
          and said so to a screen reader. */}
      <Pressable
        disabled
        accessibilityRole="button"
        accessibilityLabel="Join"
        accessibilityState={{ disabled: true }}
        style={styles.join}
      >
        <Text style={styles.joinLabel}>Join</Text>
      </Pressable>
    </>
  );

  if (glass) {
    const bottom = Math.max(insets.bottom + 4, 8);
    return (
      <View
        style={[styles.floating, { bottom }]}
        onLayout={(event) => onHeight(event.nativeEvent.layout.height + bottom)}
      >
        <Surface glass style={styles.bubble}>
          {inside}
        </Surface>
      </View>
    );
  }
  return (
    <View
      style={[styles.band, { paddingBottom: insets.bottom + 14 }]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      {inside}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    floating: {
      position: "absolute",
      left: 8,
      right: 8,
    },
    bubble: {
      gap: 12,
      padding: BUBBLE_PAD,
      borderRadius: JOIN / 2 + BUBBLE_PAD,
    },
    band: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      gap: 12,
      paddingTop: 14,
      paddingHorizontal: 20,
      backgroundColor: theme.surface,
    },
    here: {
      textAlign: "center",
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    join: {
      height: JOIN,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
      opacity: tokens.disabled,
    },
    joinLabel: {
      color: theme.onAccent,
      fontSize: 17,
      fontWeight: "700",
    },
  });
}
