import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hostOf, normalizeServerUrl, type Probe, probeServer } from "../../api/probe";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { type Theme, tokens, useTheme } from "../../theme";
import ProbeCard from "./ProbeCard";

// Typing a server's address. The app checks it a moment after typing
// stops and says what it found; Continue opens only for a Stoop server
// new enough for this app, and goes on to sign in to it.

export type Check =
  | { state: "idle" }
  | { state: "checking"; host: string }
  | { state: "done"; probe: Probe };

// Long enough not to ask about every letter of a half-typed address.
const SETTLE_MS = 600;

export default function AddServer() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const [address, setAddress] = useState("");
  const [focused, setFocused] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const router = useRouter();

  useEffect(() => {
    const origin = normalizeServerUrl(address);
    if (!origin) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCheck({ state: "checking", host: hostOf(origin) });
      probeServer(origin, controller.signal).then((probe) => {
        if (!controller.signal.aborted) setCheck({ state: "done", probe });
      });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address]);

  const found = check.state === "done" && check.probe.kind === "found" ? check.probe : null;

  return (
    <View style={[styles.screen, { paddingBottom: (keyboard || insets.bottom) + 8 }]}>
      <ScrollView contentContainerStyle={styles.main} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.title} accessibilityRole="header">
            Add a server
          </Text>
          <Text style={styles.lede}>
            The address you'd open in a browser. https:// is added for you.
          </Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.label} nativeID="server-address">
            Server address
          </Text>
          <TextInput
            value={address}
            onChangeText={(text) => {
              // A result belongs to the address it was asked about.
              setAddress(text);
              setCheck({ state: "idle" });
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel="Server address"
            testID="server-address"
            accessibilityLabelledBy="server-address"
            placeholder="chat.example.org"
            placeholderTextColor={theme.textMuted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="done"
            style={[styles.input, focused && styles.inputFocused]}
          />
        </View>
        <ProbeCard check={check} />
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !found }}
          disabled={!found}
          onPress={() =>
            found && router.push({ pathname: "/sign-in", params: { server: found.origin } })
          }
          style={({ pressed }) => [
            styles.button,
            !found && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonLabel}>Continue</Text>
        </Pressable>
      </View>
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
      gap: 20,
      paddingTop: 8,
      paddingHorizontal: 24,
      paddingBottom: 24,
    },
    intro: {
      gap: 6,
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
    footer: {
      paddingHorizontal: 24,
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
