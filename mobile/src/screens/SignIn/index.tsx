import type { GetInstanceStatusResponse } from "@stoop/gen/stoop/instance/v1/instance_pb";
import { PasswordSignIn, RegistrationPolicy } from "@stoop/gen/stoop/instance/v1/instance_pb";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { instanceClient } from "../../api/clients";
import { hostOf } from "../../api/probe";
import {
  createAccount,
  signInErrorText,
  signInWithPassword,
  signInWithProvider,
} from "../../api/signIn";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { useServers } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ModeToggle, { type Mode } from "./ModeToggle";
import ProviderButtons from "./ProviderButtons";
import ServerPill from "./ServerPill";

// Signing in to a server just added: a password, a login provider, or a
// new account where the server takes them without an invite. What it
// offers comes from the server's instance status, as on web's login card
// (web/src/routes/Login.tsx), and a sign-in is saved for the server here.

type Status =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; status: GetInstanceStatusResponse };

export default function SignIn({ origin }: { origin: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { signedIn } = useServers();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState<"username" | "password" | null>(null);
  // An admin's way to the password form where it is otherwise hidden.
  const [forcePassword, setForcePassword] = useState(false);
  // "password", or the provider whose round trip is under way.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus({ state: "loading" });
    instanceClient(origin)
      .getInstanceStatus({})
      .then((status) => setStatus({ state: "ready", status }))
      .catch(() => setStatus({ state: "failed" }));
  }, [origin]);
  useEffect(load, [load]);

  const name = status.state === "ready" ? status.status.instanceName || hostOf(origin) : hostOf(origin);
  const header = <Stack.Screen options={{ headerTitle: () => <ServerPill origin={origin} name={name} /> }} />;

  if (status.state !== "ready") {
    return (
      <View style={[styles.screen, styles.center]}>
        {header}
        {status.state === "loading" ? (
          <ActivityIndicator color={theme.textMuted} />
        ) : (
          <View style={styles.notice} accessibilityRole="alert">
            <Text style={styles.noticeHeading}>Can't reach {hostOf(origin)}</Text>
            <Text style={styles.noticeBody}>
              Check that this phone is on a network that can reach the server.
            </Text>
            <Pressable accessibilityRole="button" onPress={load} style={styles.secondary}>
              <Text style={styles.secondaryLabel}>Try again</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const s = status.status;
  if (s.needsSetup) {
    return (
      <View style={[styles.screen, styles.center]}>
        {header}
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeHeading}>{name} isn't set up yet</Text>
          <Text style={styles.noticeBody}>
            Its first account is made in a browser. Open {hostOf(origin)} there to finish
            setting it up, then come back to sign in.
          </Text>
        </View>
      </View>
    );
  }

  const providers = s.loginProviders;
  const passwordSignIn = s.passwordSignIn;
  // As web's passwordFormShown: admins-only or off, the form hides unless
  // asked for, and never when there is no provider to use instead.
  const showForm =
    passwordSignIn === PasswordSignIn.EVERYONE || forcePassword || providers.length === 0;
  // Only where an account needs no invite: invite-only servers are joined
  // from an invite link.
  const canCreate =
    s.registrationPolicy === RegistrationPolicy.OPEN &&
    passwordSignIn === PasswordSignIn.EVERYONE;
  const creating = canCreate && mode === "create";

  const finish = async (token: string) => {
    const id = await signedIn(origin, name, token);
    router.dismissAll();
    router.replace({ pathname: "/s/[id]", params: { id } });
  };

  const submitPassword = async () => {
    setBusy("password");
    setError(null);
    try {
      const signIn = creating ? createAccount : signInWithPassword;
      await finish(await signIn(origin, username.trim(), password));
    } catch (err) {
      setError(signInErrorText(err));
      setBusy(null);
    }
  };

  const continueWith = async (provider: string) => {
    setBusy(provider);
    setError(null);
    try {
      const result = await signInWithProvider(origin, provider);
      if (result.kind === "signedIn") {
        await finish(result.token);
        return;
      }
    } catch (err) {
      setError(signInErrorText(err));
    }
    setBusy(null);
  };

  const ready = username.trim() !== "" && password !== "" && busy === null;

  return (
    <View style={[styles.screen, { paddingBottom: (keyboard || insets.bottom) + 8 }]}>
      {header}
      <ScrollView contentContainerStyle={styles.main} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">
          {creating ? `Join ${name}` : `Sign in to ${name}`}
        </Text>
        {canCreate && showForm && (
          <ModeToggle
            mode={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
          />
        )}
        {showForm && (
          <>
            <View style={styles.field}>
              <Text style={styles.label} nativeID="sign-in-username">
                Username
              </Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                onFocus={() => setFocused("username")}
                onBlur={() => setFocused(null)}
                accessibilityLabel="Username"
                accessibilityLabelledBy="sign-in-username"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={creating ? "username-new" : "username"}
                textContentType="username"
                returnKeyType="next"
                style={[styles.input, focused === "username" && styles.inputFocused]}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label} nativeID="sign-in-password">
                Password
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                onSubmitEditing={() => ready && submitPassword()}
                accessibilityLabel="Password"
                accessibilityLabelledBy="sign-in-password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={creating ? "new-password" : "current-password"}
                textContentType={creating ? "newPassword" : "password"}
                returnKeyType="go"
                style={[styles.input, focused === "password" && styles.inputFocused]}
              />
            </View>
            {error && (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready, busy: busy === "password" }}
              disabled={!ready}
              onPress={submitPassword}
              style={({ pressed }) => [
                styles.button,
                !ready && busy !== "password" && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {busy === "password" ? (
                <ActivityIndicator color={theme.onAccent} />
              ) : (
                <Text style={styles.buttonLabel}>{creating ? "Create account" : "Sign in"}</Text>
              )}
            </Pressable>
          </>
        )}
        {showForm && providers.length > 0 && !creating && (
          <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.rule} />
            <Text style={styles.muted}>or</Text>
            <View style={styles.rule} />
          </View>
        )}
        {providers.length > 0 && !creating && (
          <ProviderButtons
            providers={providers}
            pending={busy !== "password" ? busy : null}
            disabled={busy !== null}
            onPress={continueWith}
          />
        )}
        {!showForm && error && (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
        {!showForm && passwordSignIn === PasswordSignIn.ADMINS && (
          <Pressable accessibilityRole="button" onPress={() => setForcePassword(true)}>
            <Text style={styles.link}>Server admin? Sign in with a password</Text>
          </Pressable>
        )}
        {providers.length > 0 && !creating && (
          <Text style={[styles.muted, styles.centered]}>
            These are the sign-in options {name} has turned on.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    center: {
      justifyContent: "center",
      paddingHorizontal: 24,
    },
    main: {
      gap: 18,
      paddingTop: 8,
      paddingHorizontal: 24,
      paddingBottom: 24,
    },
    title: {
      color: theme.text,
      fontSize: tokens.textXl,
      lineHeight: tokens.textXl * tokens.leadingTight,
      fontWeight: "700",
    },
    field: {
      gap: 6,
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    input: {
      height: 48,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    inputFocused: {
      borderColor: theme.accent,
    },
    error: {
      color: theme.danger,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    button: {
      height: 50,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    disabled: {
      opacity: tokens.disabled,
    },
    pressed: {
      opacity: 0.85,
    },
    buttonLabel: {
      color: theme.onAccent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    rule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
    },
    muted: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    centered: {
      textAlign: "center",
    },
    link: {
      color: theme.accent,
      fontSize: tokens.textUi,
      fontWeight: "600",
      textAlign: "center",
    },
    notice: {
      padding: 16,
      gap: 8,
      borderRadius: tokens.radiusLg,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
    },
    noticeHeading: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    noticeBody: {
      color: theme.text,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    secondary: {
      marginTop: 4,
      height: 44,
      borderRadius: tokens.radiusMd,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    secondaryLabel: {
      color: theme.text,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
  });
}
