import { Code, ConnectError } from "@connectrpc/connect";
import type { User } from "@stoop/gen/stoop/auth/v1/auth_pb";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authClient } from "../api/clients";
import { hostOf } from "../api/probe";
import { sessionToken } from "../api/servers";
import { type SavedServer, useServers } from "../servers";
import { type Theme, tokens, useTheme } from "../theme";

// A stand-in for the Spaces tab, which is the next screen: it proves the
// saved session works by asking the server who it belongs to, and offers
// a way out. The app opens here while a server is saved.

type Me =
  | { state: "loading" }
  | { state: "ready"; user: User }
  // The server said the session is over: revoked, expired, or the account
  // deactivated. Only this answer signs the person out, as on web.
  | { state: "ended" }
  | { state: "failed" };

export default function SignedIn({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { forget } = useServers();
  const [me, setMe] = useState<Me>({ state: "loading" });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    sessionToken(server.id)
      .then((token) => {
        if (!token) return { state: "ended" } as const;
        return authClient(server.origin, token)
          .getMe({})
          .then((res) => (res.user ? { state: "ready", user: res.user } : { state: "ended" }) as Me);
      })
      .catch((err) =>
        err instanceof ConnectError && err.code === Code.Unauthenticated
          ? ({ state: "ended" } as const)
          : ({ state: "failed" } as const),
      )
      .then((next) => live && setMe(next));
    return () => {
      live = false;
    };
  }, [server]);

  // Ends the session on the server when it can be reached, and forgets it
  // here either way; the route's guard then leaves for the start.
  const signOut = async () => {
    setLeaving(true);
    const token = await sessionToken(server.id).catch(() => null);
    if (token) await authClient(server.origin, token).logout({}).catch(() => {});
    await forget(server.id);
  };

  const signInAgain = () =>
    router.replace({ pathname: "/sign-in", params: { server: server.origin } });

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.main}>
        <Text style={styles.title} accessibilityRole="header">
          {server.name}
        </Text>
        <Text style={styles.muted}>{hostOf(server.origin)}</Text>
        {me.state === "loading" && <ActivityIndicator color={theme.textMuted} />}
        {me.state === "ready" && (
          <Text style={styles.body}>
            Signed in as {me.user.displayName || me.user.username}. Spaces come in the next
            build.
          </Text>
        )}
        {me.state === "ended" && (
          <Text style={styles.body} accessibilityRole="alert">
            Your sign-in to {server.name} has ended. Sign in again to carry on.
          </Text>
        )}
        {me.state === "failed" && (
          <Text style={styles.body} accessibilityRole="alert">
            Couldn't reach {hostOf(server.origin)}. You're still signed in.
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        {me.state === "ended" && (
          <Pressable
            accessibilityRole="button"
            onPress={signInAgain}
            style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryLabel}>Sign in again</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: leaving }}
          disabled={leaving}
          onPress={signOut}
          style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryLabel}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: "space-between",
      paddingHorizontal: 24,
      backgroundColor: theme.surface,
    },
    main: {
      gap: 8,
    },
    title: {
      color: theme.text,
      fontSize: tokens.textXl,
      lineHeight: tokens.textXl * tokens.leadingTight,
      fontWeight: "700",
    },
    muted: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
    body: {
      marginTop: 8,
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    actions: {
      gap: 10,
    },
    button: {
      height: 50,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
    },
    primary: {
      backgroundColor: theme.accent,
    },
    secondary: {
      backgroundColor: theme.raised,
    },
    pressed: {
      opacity: 0.85,
    },
    primaryLabel: {
      color: theme.onAccent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    secondaryLabel: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
