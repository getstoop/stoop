import { NativeTabs } from "expo-router/native-tabs";
import { useTheme } from "../../../../theme";

// On iOS the four tabs are the system's own tab bar (Liquid Glass from
// iOS 26), with SF Symbols for icons, as the native back button the
// pushed screens already have. Android keeps the drawn bar in
// _layout.tsx until it has icons of its own.
// The tab a server opens on when nothing in the URL names one, as when
// the switcher swaps a server in: Spaces, which lives in its own folder
// as a stack, so the tabs can't tell it is the first by its name.
export const unstable_settings = { anchor: "(spaces)" };

export default function TabsLayout() {
  const theme = useTheme();
  // Each tab's native container, painted the theme's surface, so a tab
  // opened for the first time doesn't flash the system background before
  // its screen draws.
  const content = { backgroundColor: theme.surface };

  return (
    <NativeTabs tintColor={theme.accent}>
      <NativeTabs.Trigger name="(spaces)" testID="tab-spaces" contentStyle={content}>
        <NativeTabs.Trigger.Label>Spaces</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity" testID="tab-activity" contentStyle={content}>
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bell", selected: "bell.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages" testID="tab-messages" contentStyle={content}>
        <NativeTabs.Trigger.Label>Messages</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="you" testID="tab-you" contentStyle={content}>
        <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "person", selected: "person.fill" }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
