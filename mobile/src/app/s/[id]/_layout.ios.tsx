import { Redirect, useLocalSearchParams } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { CurrentServer, useServer } from "../../../servers";
import { useTheme } from "../../../theme";

// On iOS the four tabs are the system's own tab bar (Liquid Glass from
// iOS 26), with SF Symbols for icons, as the native back button the
// pushed screens already have. Android keeps the drawn bar in
// _layout.tsx until it has icons of its own. The rest is as there: an ID
// this phone doesn't have goes back to the start, and the tabs read the
// server from CurrentServer.
export default function ServerLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const server = useServer(id);
  if (!server) return <Redirect href="/" />;

  return (
    <CurrentServer server={server}>
      <NativeTabs tintColor={theme.accent}>
        <NativeTabs.Trigger name="index" testID="tab-spaces">
          <NativeTabs.Trigger.Label>Spaces</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
          />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="activity" testID="tab-activity">
          <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "bell", selected: "bell.fill" }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="messages" testID="tab-messages">
          <NativeTabs.Trigger.Label>Messages</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="you" testID="tab-you">
          <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "person", selected: "person.fill" }} />
        </NativeTabs.Trigger>
      </NativeTabs>
    </CurrentServer>
  );
}
