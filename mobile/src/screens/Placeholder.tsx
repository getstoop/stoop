import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Theme, tokens, useTheme } from "../theme";

// A tab whose screen isn't built yet: its title, and nothing else, so the
// tab bar is whole while the screens arrive one at a time.
export default function Placeholder({ title }: { title: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 44 }]}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    title: {
      marginTop: 12,
      marginHorizontal: 20,
      color: theme.text,
      fontSize: tokens.textDisplay,
      lineHeight: tokens.textDisplay * tokens.leadingTight,
      fontWeight: "700",
    },
  });
}
