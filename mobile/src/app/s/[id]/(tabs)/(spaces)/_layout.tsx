import { Stack } from "expo-router";
import { useTheme } from "../../../../../theme";

// The Spaces tab is a stack of its own, so a space's channels push over
// the list with the tab bar still showing. The list carries its own
// heading; a space's screen gets the platform's back button over its own.
export default function SpacesStack() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        title: "",
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.surface },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
