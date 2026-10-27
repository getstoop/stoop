import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../../theme";

// A fade from the theme's surface over the head of the list: the rows
// scrolling under the status bar all but vanish beneath the time and
// the battery, which stay readable, and the fade is gone a little below
// the status bar, so the header's pill floats over plain rows.
const BELOW = 20;

export default function TopFade() {
  const theme = useTheme();
  const height = useSafeAreaInsets().top + BELOW;
  return (
    <View style={[styles.fade, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.surface} stopOpacity="1" />
            <Stop offset="0.55" stopColor={theme.surface} stopOpacity="0.92" />
            <Stop offset="1" stopColor={theme.surface} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
});
