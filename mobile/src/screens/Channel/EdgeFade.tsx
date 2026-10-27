import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../../theme";

// A fade from the theme's surface over one end of the list: the rows
// scrolling under the edge all but vanish beneath the status bar's time
// and battery, or the home indicator, which stay readable, and the fade
// is gone a little further in, so the header's pill, and the composer's
// card, float over rows that still show through. Near-solid over the
// first half and a little more, then out.
export default function EdgeFade({ edge, height }: { edge: "top" | "bottom"; height: number }) {
  const theme = useTheme();
  // The gradient runs away from the edge: down from the top, up from the
  // bottom.
  const [y1, y2] = edge === "top" ? ["0", "1"] : ["1", "0"];
  return (
    <View style={[styles.fade, { [edge]: 0, height }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`fade-${edge}`} x1="0" y1={y1} x2="0" y2={y2}>
            <Stop offset="0" stopColor={theme.surface} stopOpacity="1" />
            <Stop offset="0.55" stopColor={theme.surface} stopOpacity="0.92" />
            <Stop offset="1" stopColor={theme.surface} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#fade-${edge})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
