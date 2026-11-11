import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "../../../../../theme";

// The Spaces tab is a stack of its own, so a space's channels push over
// the list with the tab bar still showing. The list carries its own
// heading; a space's screen has no bar of its own, as a channel's has
// none (the server's layout): its channels scroll under the back button
// and the title's pill, and the screen pads them by the header's height.
// The pill takes the row beside the back button, so Android starts it
// there rather than centring it over the button.
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
      <Stack.Screen
        name="space/[spaceId]/index"
        options={{
          headerTransparent: true,
          headerTitleAlign: Platform.OS === "ios" ? "center" : "left",
          headerStyle: { backgroundColor: "transparent" },
        }}
      />
    </Stack>
  );
}
