import { badgeCount } from "@stoop/core/unreads";
import { Tabs } from "expo-router";
import { BottomTabBar } from "expo-router/tabs";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlerts } from "../../../../alerts/AlertsProvider";
import { BellIcon, MessagesIcon, PersonIcon, SpacesIcon } from "../../../../components/Icons";
import CallBar from "../../../../components/CallBar";
import ServerChip from "../../../../components/ServerChip";
import { TAB_BAR_OVERLAP, useTabRow } from "../../../../hooks/useServerChipRoom";
import { tokens, useTheme } from "../../../../theme";

// A server's four tabs, at the bottom of its stack (../_layout.tsx). This
// drawn tab bar is Android's; iOS uses the system's own (_layout.ios.tsx).
// Each tab's screen puts its own heading in its body, so the tabs carry
// no header. Activity's badge is the server's count of what is addressed
// to you in the spaces past your markers, and Messages' the unread
// messages in your conversations (src/alerts), each hidden at none.
// With more than one server saved the server chip is docked on the bar,
// part of it; in a call the call bar is, in the chip's place, with any
// number of servers. The top of the bar (the row's, when one shows) is rounded
// as a sheet's is: the bar is pulled up over the foot of the screen by
// the radius, so the screen shows in the corners, and the screens' lists
// pad by as much (hooks/useServerChipRoom.ts).
// The tab a server opens on when nothing in the URL names one, as when
// the switcher swaps a server in: Spaces, which lives in its own folder
// as a stack, so the tabs can't tell it is the first by its name.
export const unstable_settings = { anchor: "(spaces)" };

// The bar's own height is iOS's (49), which leaves the icons 5 under its
// top line while the system's gesture area gives the labels air below:
// this much more goes above the icons, so the bar reads even.
const TAB_BAR_HEIGHT = 49;
const TAB_BAR_TOP_ROOM = 8;

export default function TabsLayout() {
  const theme = useTheme();
  const { activity: alerting, messages: unread } = useAlerts();
  const badgeStyle = { backgroundColor: theme.danger, color: theme.onAccent };
  const row = useTabRow();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      tabBar={(props) => (
        <View
          style={{
            marginTop: -TAB_BAR_OVERLAP,
            borderTopLeftRadius: tokens.radiusLg,
            borderTopRightRadius: tokens.radiusLg,
            borderWidth: StyleSheet.hairlineWidth,
            borderBottomWidth: 0,
            borderColor: theme.border,
            backgroundColor: theme.panel,
            overflow: "hidden",
          }}
        >
          {row === "call" ? <CallBar lined={false} /> : row === "chip" && <ServerChip lined={false} />}
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.panel,
          // The line over the tabs is the row's foot; with no row the
          // rounded top draws its own.
          borderTopColor: theme.border,
          borderTopWidth: row ? StyleSheet.hairlineWidth : 0,
          height: TAB_BAR_HEIGHT + TAB_BAR_TOP_ROOM + insets.bottom,
          paddingTop: TAB_BAR_TOP_ROOM,
        },
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
          tabBarBadgeStyle: badgeStyle,
          tabBarIcon: ({ color }) => <BellIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarButtonTestID: "tab-messages",
          tabBarBadge: unread > 0 ? badgeCount(unread) : undefined,
          tabBarAccessibilityLabel: unread > 0 ? `Messages, ${badgeCount(unread)} unread` : "Messages",
          tabBarBadgeStyle: badgeStyle,
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
