import { Redirect, Tabs, useLocalSearchParams } from "expo-router";
import { BellIcon, MessagesIcon, PersonIcon, SpacesIcon } from "../../../components/Icons";
import { CurrentServer, useServer } from "../../../servers";
import { useTheme } from "../../../theme";

// Everything under /s/<id> is one saved server, as four tabs; an ID this
// phone doesn't have goes back to the start. This drawn tab bar is
// Android's; iOS uses the system's own (_layout.ios.tsx). Each tab's screen puts its
// own heading in its body, so the tabs carry no header. The tabs read the
// server from CurrentServer: one reached by pressing it gets none of this
// layout's route params.
export default function ServerLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const server = useServer(id);
  if (!server) return <Redirect href="/" />;

  return (
    <CurrentServer server={server}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarStyle: { backgroundColor: theme.panel, borderTopColor: theme.border },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
          sceneStyle: { backgroundColor: theme.surface },
        }}
      >
        <Tabs.Screen
          name="(spaces)"
          options={{
            title: "Spaces",
            tabBarButtonTestID: "tab-spaces",
            tabBarIcon: ({ color }) => <SpacesIcon color={color} />,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: "Activity",
            tabBarButtonTestID: "tab-activity",
            tabBarIcon: ({ color }) => <BellIcon color={color} />,
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: "Messages",
            tabBarButtonTestID: "tab-messages",
            tabBarIcon: ({ color }) => <MessagesIcon color={color} />,
          }}
        />
        <Tabs.Screen
          name="you"
          options={{
            title: "You",
            tabBarButtonTestID: "tab-you",
            tabBarIcon: ({ color }) => <PersonIcon color={color} />,
          }}
        />
      </Tabs>
    </CurrentServer>
  );
}
