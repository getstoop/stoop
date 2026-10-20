import type { GetInstanceStatusResponse } from "@stoop/gen/stoop/instance/v1/instance_pb";
import { PasswordSignIn, RegistrationPolicy } from "@stoop/gen/stoop/instance/v1/instance_pb";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { instanceClient } from "../../api/clients";
import { joinWithInvite } from "../../api/invites";
import { resetOffered } from "../../api/passwordReset";
import { hostOf } from "../../api/probe";
import {
  createAccount,
  signInErrorText,
  signInWithPassword,
  signInWithProvider,
} from "../../api/signIn";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import ServerPill from "../../components/ServerPill";
import { useServers } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ModeToggle, { type Mode } from "./ModeToggle";
import PasswordForm from "./PasswordForm";
import ProviderButtons from "./ProviderButtons";
import StatusNotice from "./StatusNotice";

// Signing in to a server just added: a password, a login provider, or a
// new account where the server takes them without an invite. What it
// offers comes from the server's instance status, as on web's login card
// (web/src/routes/Login.tsx), and a sign-in is saved for the server here.
// Reached from Invite, it carries the invite code, and joins its space
// once signed in.

type Status =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; status: GetInstanceStatusResponse };

export default function SignIn({ origin, invite }: { origin: string; invite?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { signedIn } = useServers();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [mode, setMode] = useState<Mode>("sign-in");
  // An admin's way to the password form where it is otherwise hidden.
  const [forcePassword, setForcePassword] = useState(false);
  // "password", or the provider whose round trip is under way.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // False once the person has left this screen: a sign-in that answers
  // after that was abandoned, and neither saves nor takes them anywhere.
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

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

  if (status.state !== "ready" || status.status.needsSetup) {
    const notice =
      status.state === "loading" ? "loading" : status.state === "failed" ? "unreachable" : "needs-setup";
    return (
      <View style={[styles.screen, styles.center]}>
        {header}
        <StatusNotice notice={notice} origin={origin} name={name} onRetry={load} />
      </View>
    );
  }

  const s = status.status;
  const providers = s.loginProviders;
  const passwordSignIn = s.passwordSignIn;
  // As web's passwordFormShown: admins-only or off, the form hides unless
  // asked for, and never when there is no provider to use instead.
  const showForm =
    passwordSignIn === PasswordSignIn.EVERYONE || forcePassword || providers.length === 0;
  // Only where an account needs no invite: invite-only servers are joined
  // from an invite link. Come from one, the account is made back there.
  const canCreate =
    !invite &&
    s.registrationPolicy === RegistrationPolicy.OPEN &&
    passwordSignIn === PasswordSignIn.EVERYONE;
  const creating = canCreate && mode === "create";
  // As web's forgotLinkShown: the server can email a link, and password
  // sign-in isn't off.
  const forgot = resetOffered(s.passwordResetAvailable, passwordSignIn)
    ? () => router.push({ pathname: "/forgot-password", params: { server: origin } })
    : undefined;

  const finish = async (token: string) => {
    if (!here.current) return;
    const id = await signedIn(origin, name, token);
    if (invite) {
      // Signed in either way: an invite that fails now (used up since it
      // was checked) is said, and the person still lands on the server.
      await joinWithInvite(origin, token, invite).catch((err) =>
        Alert.alert("Couldn't join the space", signInErrorText(err)),
      );
    }
    // Saving waits on the keychain, and they may have left meanwhile: the
    // sign-in is kept, but nobody is moved off the screen they went to.
    if (!here.current) return;
    // Opened from a link, sign-in can be the only screen in the stack,
    // with nothing under it to dismiss.
    if (router.canDismiss()) router.dismissAll();
    router.replace({ pathname: "/s/[id]", params: { id } });
  };

  const submitPassword = async (username: string, password: string) => {
    setBusy("password");
    setError(null);
    try {
      const signIn = creating ? createAccount : signInWithPassword;
      await finish(await signIn(origin, username, password));
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
          <PasswordForm
            creating={creating}
            pending={busy === "password"}
            locked={busy !== null}
            error={error}
            onSubmit={submitPassword}
            onForgot={forgot}
          />
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
    error: {
      color: theme.danger,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
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
  });
}
