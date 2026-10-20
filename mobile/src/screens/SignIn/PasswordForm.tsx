import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { type Theme, tokens, useTheme } from "../../theme";

// Username and password, to sign in or, on a server that takes new
// accounts, to create one, where the password is typed twice so a slip
// of the thumb doesn't lock someone out of an account they just made. The screen above it does the signing in;
// `pending` is its password attempt under way, `locked` any attempt
// (a provider's too), which keeps a second one from starting.
export default function PasswordForm({
  creating,
  pending,
  locked,
  error,
  onSubmit,
  onForgot,
  submitLabel,
}: {
  creating: boolean;
  pending: boolean;
  locked: boolean;
  error: string | null;
  onSubmit: (username: string, password: string) => void;
  // Given where the server can email a reset link; shown beside the
  // password when signing in, never when creating an account.
  onForgot?: () => void;
  // The button's words where the default ("Sign in", "Create account")
  // doesn't say all it does.
  submitLabel?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [focused, setFocused] = useState<"username" | "password" | "confirm" | null>(null);

  const matches = !creating || confirm === password;
  // Said once the second password is as long as the first, not while it
  // is still being typed.
  const mismatch = creating && confirm.length >= password.length && confirm !== "" && !matches;
  const ready = username.trim() !== "" && password !== "" && matches && !locked;
  const submit = () => ready && onSubmit(username.trim(), password);

  return (
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
          testID="username"
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
        <View style={styles.labelRow}>
          <Text style={styles.label} nativeID="sign-in-password">
            Password
          </Text>
          {onForgot && !creating && (
            <Pressable accessibilityRole="link" onPress={onForgot} hitSlop={12}>
              <Text style={styles.forgot}>Forgot password?</Text>
            </Pressable>
          )}
        </View>
        <TextInput
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocused("password")}
          onBlur={() => setFocused(null)}
          onSubmitEditing={creating ? undefined : submit}
          accessibilityLabel="Password"
          testID="password"
          accessibilityLabelledBy="sign-in-password"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={creating ? "new-password" : "current-password"}
          textContentType={creating ? "newPassword" : "password"}
          returnKeyType={creating ? "next" : "go"}
          style={[styles.input, focused === "password" && styles.inputFocused]}
        />
      </View>
      {creating && (
        <View style={styles.field}>
          <Text style={styles.label} nativeID="sign-in-confirm">
            Confirm password
          </Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            onFocus={() => setFocused("confirm")}
            onBlur={() => setFocused(null)}
            onSubmitEditing={submit}
            accessibilityLabel="Confirm password"
            testID="confirm-password"
            accessibilityLabelledBy="sign-in-confirm"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            style={[styles.input, focused === "confirm" && styles.inputFocused]}
          />
          {mismatch && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              The passwords don't match.
            </Text>
          )}
        </View>
      )}
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready, busy: pending }}
        disabled={!ready}
        onPress={submit}
        style={({ pressed }) => [
          styles.button,
          !ready && !pending && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        {pending ? (
          <ActivityIndicator color={theme.onAccent} />
        ) : (
          <Text style={styles.buttonLabel}>{submitLabel ?? (creating ? "Create account" : "Sign in")}</Text>
        )}
      </Pressable>
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    field: {
      gap: 6,
    },
    labelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
    },
    label: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
      fontWeight: "600",
    },
    forgot: {
      color: theme.accent,
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
  });
}
