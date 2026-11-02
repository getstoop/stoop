import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import type { SavedServer } from "../../servers";
import { useLeaveServer } from "../../servers/useLeaveServer";
import { type Theme, tokens, useTheme } from "../../theme";

// Signing out of the current server, once confirmed; the route's guard
// then leaves for the next server or the start.
export default function SignOutButton({ server }: { server: SavedServer }) {
  const styles = makeStyles(useTheme());
  const leave = useLeaveServer();
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    try {
      await leave(server);
    } catch {
      setLeaving(false);
      Alert.alert(`Couldn't sign out of ${server.name}`);
    }
  };

  const confirm = () =>
    Alert.alert(`Sign out of ${server.name}?`, "You'll need to sign in again to come back to it on this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: leaving }}
      disabled={leaving}
      onPress={confirm}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, leaving && styles.leaving]}
    >
      <Text style={styles.label}>Sign out of {server.name}</Text>
    </Pressable>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    button: {
      minHeight: 48,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    leaving: {
      opacity: 0.5,
    },
    label: {
      color: theme.danger,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
