import { Stack } from "expo-router";
import { ServersProvider } from "../servers";
import { ThemeProvider, useTheme } from "../theme";

// The root of the app. Files under src/app are routes and layouts only,
// a few lines each; the screens they show live in src/screens.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <ServersProvider>
        <RootStack />
      </ServersProvider>
    </ThemeProvider>
  );
}

// One stack for now, with the platform's own back button and gesture.
// The header carries no title: each screen puts its heading in its body.
function RootStack() {
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
      <Stack.Screen name="s/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
