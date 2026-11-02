import { StyleSheet, View } from "react-native";
import TabNotice from "../components/TabNotice";
import { useTheme } from "../theme";

// In place of the whole app while the keychain won't give up the saved
// servers. ServersProvider also tries again whenever the app becomes
// active; the button is for a failure that clears while it stays open.
export default function ServerListUnread({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: theme.surface }]}>
      <TabNotice
        message="Your servers can't be read right now."
        action={{ label: "Try again", onPress: onRetry }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
  },
});
