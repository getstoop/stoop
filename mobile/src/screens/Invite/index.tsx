import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { checkInvite, type InviteCheck, parseInviteLink } from "../../api/invites";
import { createAccount, signInErrorText } from "../../api/signIn";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { useServers } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import PasswordForm from "../SignIn/PasswordForm";
import InviteCard from "./InviteCard";

// Joining a space from an invite link, pasted here from Welcome or handed
// over by the web's open-in-app page. The link names the server, so the
// app checks the server and the invite together and says what it is for;
// then a new account is made with the invite, or an existing one signs
// in and joins. Where the server takes no new password accounts, signing
// in is the only way offered.

export type Check =
  | { state: "idle" }
  | { state: "not-link" }
  | { state: "checking" }
  | { state: "done"; result: InviteCheck };

// As Add a server: long enough not to ask about a half-pasted link.
const SETTLE_MS = 600;

export default function Invite({ initialLink = "" }: { initialLink?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { signedIn } = useServers();
  const [text, setText] = useState(initialLink);
  const [focused, setFocused] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // As sign-in's: an account made after the person left saves, but
  // moves nobody.
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

  useEffect(() => {
    if (!text.trim()) return;
    const link = parseInviteLink(text);
    const controller = new AbortController();
    // A link handed over by the app opens checked; one being typed waits.
    const timer = setTimeout(
      () => {
        if (!link) {
          setCheck({ state: "not-link" });
          return;
        }
        setCheck({ state: "checking" });
        checkInvite(link, controller.signal).then((result) => {
          if (!controller.signal.aborted) setCheck({ state: "done", result });
        });
      },
      text === initialLink ? 0 : SETTLE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, initialLink]);

  const found = check.state === "done" && check.result.kind === "found" ? check.result : null;

  const create = async (username: string, password: string) => {
    if (!found) return;
    setPending(true);
    setError(null);
    try {
      const { token, joined } = await createAccount(
        found.origin,
        username,
        password,
        found.code,
      );
      if (!here.current) return;
      const id = await signedIn(found.origin, found.serverName, token);
      if (!here.current) return;
      // The account is made and kept either way, as sign-in's join.
      if (!joined) {
        Alert.alert(
          "Couldn't join the space",
          "The invite stopped working before your account was made. Ask whoever invited you for a fresh link.",
        );
      }
      if (router.canDismiss()) router.dismissAll();
      router.replace({ pathname: "/s/[id]", params: { id } });
    } catch (err) {
      setError(signInErrorText(err));
      setPending(false);
    }
  };

  const signInAndJoin = (invite: { origin: string; code: string }) =>
    router.push({ pathname: "/sign-in", params: { server: invite.origin, invite: invite.code } });

  return (
    <View style={[styles.screen, { paddingBottom: (keyboard || insets.bottom) + 8 }]}>
      <ScrollView contentContainerStyle={styles.main} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">
          Join with an invite
        </Text>
        <View style={styles.field}>
          <Text style={styles.label} nativeID="invite-link">
            Invite link
          </Text>
          <TextInput
            value={text}
            onChangeText={(next) => {
              // A result belongs to the link it was asked about.
              setText(next);
              setCheck({ state: "idle" });
              setError(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel="Invite link"
            accessibilityLabelledBy="invite-link"
            placeholder="https://chat.example.org/join/…"
            placeholderTextColor={theme.textMuted}
            autoFocus={!initialLink}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="done"
            editable={!pending}
            style={[styles.input, focused && styles.inputFocused]}
          />
        </View>
        <InviteCard check={check} />
        {found && found.canCreate && (
          <>
            <Text style={styles.heading} accessibilityRole="header">
              Create your account
            </Text>
            <PasswordForm
              creating
              pending={pending}
              locked={pending}
              error={error}
              onSubmit={create}
              submitLabel="Create account & join"
            />
            <View style={styles.already}>
              <Text style={styles.muted}>Already on {found.serverName}?</Text>
              <Pressable
                accessibilityRole="link"
                disabled={pending}
                hitSlop={12}
                onPress={() => signInAndJoin(found)}
              >
                <Text style={styles.link}>Sign in & join</Text>
              </Pressable>
            </View>
          </>
        )}
        {found && !found.canCreate && (
          <Pressable
            accessibilityRole="button"
            onPress={() => signInAndJoin(found)}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>Sign in & join</Text>
          </Pressable>
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
    heading: {
      marginTop: 4,
      color: theme.text,
      fontSize: tokens.textLg,
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
    already: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: 4,
    },
    muted: {
      color: theme.textMuted,
      fontSize: tokens.textBody,
    },
    link: {
      color: theme.accent,
      fontSize: tokens.textBody,
      fontWeight: "600",
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
  });
}
