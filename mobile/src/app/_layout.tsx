import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import RealtimeProvider from "../realtime/RealtimeProvider";
import { ServersProvider } from "../servers";
import { ThemeProvider, useTheme } from "../theme";

// The root of the app. Files under src/app are routes and layouts only,
// a few lines each; the screens they show live in src/screens. Gestures
// (the picture viewer's) need their root view around everything.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <ServersProvider>
          <RealtimeProvider>
            <RootStack />
          </RealtimeProvider>
        </ServersProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

// One stack for now, with the platform's own back button and gesture.
// The header carries no title: each screen puts its heading in its body.
// The server switcher is a sheet, as tall as its list.
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
      <Stack.Screen
        name="servers"
        options={{
          headerShown: false,
          presentation: "formSheet",
          sheetAllowedDetents: "fitToContents",
          sheetGrabberVisible: true,
          contentStyle: { backgroundColor: theme.panel },
        }}
      />
    </Stack>
  );
}
