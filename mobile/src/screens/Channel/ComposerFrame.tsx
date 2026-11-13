import { GlassView } from "expo-glass-effect";
import { type ReactNode, useEffect, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { tokens, useTheme } from "../../theme";

// The composer's surface in one of its two states (the pill, the card),
// drawn as Surface draws one: Liquid Glass where iOS has it, else the
// theme's panel. Each state mounts its own; one given the height the
// last state stood at (`from`) grows or shrinks from it to its own,
// from its foot up, so the pill opens into the card and the card
// closes into the pill instead of changing places in one frame.
//
// While it moves, the surface is held to the foot of its place at a set
// height, over what it holds, which keeps its own height throughout and
// shows from its foot up (the card's buttons where the pill was). Its
// place takes the new height at once, so what is laid out around it
// (the list's clearance) is told once, not every frame. Then it is let
// go, and is laid out by what it holds again, as a surface that never
// moved is. At once under Reduce Motion.

// The pill's corners, and the card's: half the pill's height.
export const FRAME_RADIUS = 24;

export default function ComposerFrame({
  glass,
  margin,
  from,
  onHeight,
  style,
  children,
}: {
  glass: boolean;
  // The room at its sides.
  margin: number;
  // The height the last state's surface stood at; none for the first.
  from: number | undefined;
  // Its own height, as what it holds is laid out.
  onHeight: (height: number) => void;
  // How it lays out what it holds.
  style: ViewStyle;
  children: ReactNode;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  // Where it starts, as it was mounted.
  const [start] = useState(reduced ? undefined : from);
  // Its own height, once known, while it is still on its way there.
  const [own, setOwn] = useState<number | null>(null);
  const [moving, setMoving] = useState(start !== undefined);

  useEffect(() => {
    if (own === null) return;
    // A little past the transition's end.
    const timer = setTimeout(() => setMoving(false), tokens.dur + 40);
    return () => clearTimeout(timer);
  }, [own]);

  const measured = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    onHeight(height);
    if (!moving || own !== null) return;
    if (height === start) setMoving(false);
    else setOwn(height);
  };

  const height = own ?? start;
  return (
    <View style={[{ marginHorizontal: margin }, moving && { height }]}>
      <Animated.View
        style={[
          styles.surface,
          !glass && {
            backgroundColor: theme.panel,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            boxShadow: theme.scheme === "dark" ? "0 6px 20px rgba(0, 0, 0, 0.35)" : "0 6px 20px rgba(30, 25, 20, 0.16)",
          },
          moving && styles.held,
          moving && { height, ...GROW },
        ]}
      >
        {glass && <GlassView glassEffectStyle="regular" colorScheme={theme.scheme} style={StyleSheet.absoluteFill} />}
        <View style={style} onLayout={measured}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

const GROW = {
  transitionProperty: ["height"],
  transitionDuration: tokens.dur,
  transitionTimingFunction: "ease-out" as const,
};

const styles = StyleSheet.create({
  surface: {
    borderRadius: FRAME_RADIUS,
    overflow: "hidden",
  },
  // To the foot of its place, what it holds to its own foot.
  held: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
  },
});
