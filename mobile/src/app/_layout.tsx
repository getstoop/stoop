import { DefaultTheme, Stack, ThemeProvider as NavigationTheme } from "expo-router";
import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AlertsProvider from "../alerts/AlertsProvider";
import DndProvider from "../dnd/DndProvider";
import NotificationsProvider from "../notifications/NotificationsProvider";
import RealtimeProvider from "../realtime/RealtimeProvider";
import { ServersProvider } from "../servers";
import { ThemeProvider, useTheme } from "../theme";

// The root of the app. Files under src/app are routes and layouts only,
// a few lines each; the screens they show live in src/screens. Gestures
// (the picture viewer's) need their root view around everything. What
// arrives on any saved server's socket rings from here (src/notifications),
// and every server's badges are kept here (src/alerts), for its
// Activity and Messages tabs and, the totals added up, for the app's
// icon. Do not disturb is held here as well (src/dnd): the phone's one
// switch, and each server's account's.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <ServersProvider>
          <RealtimeProvider>
            <DndProvider>
              <AlertsProvider>
                <NotificationsProvider>
                  <RootStack />
                </NotificationsProvider>
              </AlertsProvider>
            </DndProvider>
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
//
// The navigator is told the theme too. It takes light or dark from its own
// theme, not from the system's setting, and puts that on every navigation
// bar: left at its default (light), a dark theme's bar buttons were light
// Liquid Glass. Its colours are what it paints behind a screen that is
// still arriving.
function RootStack() {
  const theme = useTheme();
  const navigation = useMemo(
    () => ({
      ...DefaultTheme,
      dark: theme.scheme === "dark",
      colors: {
        primary: theme.accent,
        background: theme.surface,
        card: theme.surface,
        text: theme.text,
        border: theme.border,
        notification: theme.danger,
      },
    }),
    [theme],
  );

  return (
    <NavigationTheme value={navigation}>
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
    </NavigationTheme>
  );
}
