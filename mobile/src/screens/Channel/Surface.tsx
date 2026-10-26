import { GlassView } from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "../../theme";

// The composer's surface, and the mention list's over it: Liquid Glass
// where iOS has it, else drawn with the theme's panel and border under
// a light shadow, as the composing mockup for Android draws it.
export default function Surface({ glass, children, style }: { glass: boolean; children: ReactNode; style: ViewStyle }) {
  const theme = useTheme();
  if (glass) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme={theme.scheme} style={[style, { overflow: "hidden" }]}>
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        style,
        {
          backgroundColor: theme.panel,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
          boxShadow: theme.scheme === "dark" ? "0 6px 20px rgba(0, 0, 0, 0.35)" : "0 6px 20px rgba(30, 25, 20, 0.16)",
        },
      ]}
    >
      {children}
    </View>
  );
}
