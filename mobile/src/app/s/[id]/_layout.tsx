import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { CurrentServer, useServer } from "../../../servers";
import { useTheme } from "../../../theme";

// Everything under /s/<id> is one saved server; an ID this phone doesn't
// have goes back to the start. A stack: the four tabs at the bottom of
// it, and a channel pushed over them, as a conversation covers the tab
// bar in the system's own apps, with room for the composer. What is
// under it reads the server from CurrentServer: a screen reached by
// pressing gets none of this layout's route params.
export const unstable_settings = { anchor: "(tabs)" };

export default function ServerLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const server = useServer(id);
  if (!server) return <Redirect href="/" />;

  return (
    <CurrentServer server={server}>
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
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </CurrentServer>
  );
}
