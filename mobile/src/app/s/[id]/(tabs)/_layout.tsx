import { alertingCount } from "@stoop/core/activity";
import { badgeCount } from "@stoop/core/unreads";
import { Tabs } from "expo-router";
import { useActivity } from "../../../../activity/ActivityProvider";
import { BellIcon, MessagesIcon, PersonIcon, SpacesIcon } from "../../../../components/Icons";
import { useTheme } from "../../../../theme";

// A server's four tabs, at the bottom of its stack (../_layout.tsx). This
// drawn tab bar is Android's; iOS uses the system's own (_layout.ios.tsx).
// Each tab's screen puts its own heading in its body, so the tabs carry
// no header. Activity's badge counts what is unread and addressed to
// you there (core/activity alertingCount), hidden at none.
// The tab a server opens on when nothing in the URL names one, as when
// the switcher swaps a server in: Spaces, which lives in its own folder
// as a stack, so the tabs can't tell it is the first by its name.
export const unstable_settings = { anchor: "(spaces)" };

export default function TabsLayout() {
  const theme = useTheme();
  const { feed } = useActivity();
  const alerting = alertingCount(feed.state === "ready" ? feed.data : undefined);

  return (
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
          tabBarBadge: alerting > 0 ? badgeCount(alerting) : undefined,
          // The badge said, as iOS says its own ("1 item"), for a screen
          // reader and the flows.
          tabBarAccessibilityLabel: alerting > 0 ? `Activity, ${badgeCount(alerting)} new` : "Activity",
          tabBarBadgeStyle: { backgroundColor: theme.danger, color: theme.onAccent },
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
  );
}
