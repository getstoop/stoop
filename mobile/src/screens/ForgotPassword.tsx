import type { GetInstanceStatusResponse } from "@stoop/gen/stoop/instance/v1/instance_pb";
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
import { authClient, instanceClient } from "../api/clients";
import { emailAddressError, resetOffered } from "../api/passwordReset";
import { hostOf } from "../api/probe";
import { signInErrorText } from "../api/signIn";
import ServerPill from "../components/ServerPill";
import { useKeyboardHeight } from "../hooks/useKeyboardHeight";
import { type Theme, tokens, useTheme } from "../theme";

// Asking a server for a password reset link, from sign-in's "Forgot
// password?". Worded as web's page (web/src/routes/ForgotPassword.tsx).
// The emailed link opens the server's own reset page in a browser; the
// new password is set there, and the person comes back to sign in.

type Status =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; status: GetInstanceStatusResponse };

export default function ForgotPassword({ origin }: { origin: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus({ state: "loading" });
    instanceClient(origin)
      .getInstanceStatus({})
      .then((status) => setStatus({ state: "ready", status }))
      .catch(() => setStatus({ state: "failed" }));
  }, [origin]);
  useEffect(load, [load]);

  const name =
    status.state === "ready" ? status.status.instanceName || hostOf(origin) : hostOf(origin);
  const header = (
    <Stack.Screen options={{ headerTitle: () => <ServerPill origin={origin} name={name} /> }} />
  );

  const submit = async () => {
    const shapeError = emailAddressError(email);
    if (shapeError) {
      setError(shapeError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authClient(origin).requestPasswordReset({ email: email.trim() });
      setSentTo(email.trim());
    } catch (err) {
      setError(signInErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondary}>
      <Text style={styles.secondaryLabel}>Back to sign in</Text>
    </Pressable>
  );

  let body;
  if (status.state === "loading") {
    body = <ActivityIndicator color={theme.textMuted} />;
  } else if (status.state === "failed") {
    body = (
      <>
        <Text style={styles.error} accessibilityRole="alert">
          Can't reach {hostOf(origin)}. Check that this phone is on a network that can reach the
          server.
        </Text>
        <Pressable accessibilityRole="button" onPress={load} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Try again</Text>
        </Pressable>
      </>
    );
  } else if (!resetOffered(status.status.passwordResetAvailable, status.status.passwordSignIn)) {
    body = (
      <>
        <Text style={styles.lede}>
          This server can't send password reset links. Ask an admin of {name} to reset your
          password.
        </Text>
        {back}
      </>
    );
  } else if (sentTo !== null) {
    body = (
      <>
        <Text style={styles.title} accessibilityRole="header">
          Check your email
        </Text>
        <Text style={styles.lede}>
          If an account on {name} has the address {sentTo}, we've sent it a link. It works for an
          hour, and opens in your browser to set a new password. Then come back here to sign in.
        </Text>
        <Text style={styles.hint}>
          No email? Check spam, or ask an admin of {name} to reset your password.
        </Text>
        {back}
      </>
    );
  } else {
    body = (
      <>
        <Text style={styles.title} accessibilityRole="header">
          Forgot your password?
        </Text>
        <Text style={styles.lede}>
          Enter your account's email address and we'll send you a link to set a new one.
        </Text>
        <View style={styles.field}>
          <Text style={styles.label} nativeID="forgot-email">
            Email address
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => !busy && submit()}
            accessibilityLabel="Email address"
            accessibilityLabelledBy="forgot-email"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            style={[styles.input, focused && styles.inputFocused]}
          />
        </View>
        {error && (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={submit}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={styles.buttonLabel}>Send reset link</Text>
          )}
        </Pressable>
      </>
    );
  }

  return (
    <View style={[styles.screen, { paddingBottom: (keyboard || insets.bottom) + 8 }]}>
      {header}
      <ScrollView contentContainerStyle={styles.main} keyboardShouldPersistTaps="handled">
        {body}
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
    lede: {
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    hint: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
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
    pressed: {
      opacity: 0.85,
    },
    buttonLabel: {
      color: theme.onAccent,
      fontSize: tokens.textBody,
      fontWeight: "600",
    },
    secondary: {
      height: 48,
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
