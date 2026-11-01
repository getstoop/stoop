import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { authClient } from "../../api/clients";
import { sessionToken } from "../../api/servers";
import { type SavedServer, useServers } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";

const LOGOUT_TIMEOUT_MS = 5000;

// Signing out of the current server, once confirmed. It ends the session
// on the server when it can be reached, and forgets it here either way;
// the route's guard then leaves for the next server or the start. The
// server gets a few seconds: one that never answers mustn't keep the
// token saved and the button stuck.
export default function SignOutButton({ server }: { server: SavedServer }) {
  const styles = makeStyles(useTheme());
  const { forget } = useServers();
  const [leaving, setLeaving] = useState(false);

  const signOut = async () => {
    setLeaving(true);
    const token = await sessionToken(server.id).catch(() => null);
    if (token) {
      await authClient(server.origin, token)
        .logout({}, { timeoutMs: LOGOUT_TIMEOUT_MS })
        .catch(() => {});
    }
    try {
      await forget(server.id);
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
