import { Stack } from "expo-router";
import { useTheme } from "../../../../../theme";

// The Spaces tab is a stack of one screen: the server's bar, the rail
// of its spaces and the selected space's channels, all on that screen
// (src/screens/Spaces), which carries no header of its own. It stays a
// folder so the tabs can anchor on "(spaces)" (../_layout.tsx); a
// channel pushes over the tabs, on the server's stack.
export default function SpacesStack() {
  const theme = useTheme();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.canvas } }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
