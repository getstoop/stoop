import MaskedView from "@react-native-masked-view/masked-view";
import { GlassView } from "expo-glass-effect";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../../theme";

// The EdgeFade's twin where iOS has Liquid Glass: a strip of glass over
// one end of the list, masked by the same curve the fade uses, so the
// rows blur by degrees as they near the edge instead of washing out.
// The glass carries the theme's tint, so the status bar's time and the
// home indicator stay readable over it. Nothing here is drawn where
// the glass isn't (ComposerDock chooses).

// The masked view's class types predate React 19's, so its props are
// spelled out here: the mask, and what shows through it.
const Masked = MaskedView as unknown as ComponentType<{
  maskElement: ReactElement;
  style?: ViewStyle;
  children?: ReactNode;
}>;

export default function EdgeBlur({ edge, height }: { edge: "top" | "bottom"; height: number }) {
  const theme = useTheme();
  // The mask is opaque at the edge and gone at the far end: the gradient
  // runs down from the top, up from the bottom.
  const [y1, y2] = edge === "top" ? ["0", "1"] : ["1", "0"];
  return (
    <View style={[styles.strip, { [edge]: 0, height }]} pointerEvents="none">
      <Masked
        style={styles.fill}
        maskElement={
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={`blur-${edge}`} x1="0" y1={y1} x2="0" y2={y2}>
                <Stop offset="0" stopColor="#000" stopOpacity="1" />
                <Stop offset="0.3" stopColor="#000" stopOpacity="0.96" />
                <Stop offset="0.5" stopColor="#000" stopOpacity="0.82" />
                <Stop offset="0.7" stopColor="#000" stopOpacity="0.55" />
                <Stop offset="0.85" stopColor="#000" stopOpacity="0.26" />
                <Stop offset="1" stopColor="#000" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#blur-${edge})`} />
          </Svg>
        }
      >
        <GlassView glassEffectStyle="regular" colorScheme={theme.scheme} style={styles.fill} />
      </Masked>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  fill: {
    flex: 1,
  },
});
