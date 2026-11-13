import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { findInvite, joinSpace, sentence, stopped } from "../../api/invites";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { loadSpaces } from "../../api/spaces";
import TabNotice from "../../components/TabNotice";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useLastSpaceStore } from "../../lastSpace/LastSpaceProvider";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import type { Check } from "../Invite";
import InviteCard from "../Invite/InviteCard";
import InviteNotice from "../Invite/InviteNotice";
import { landOn, withdraw } from "./landed";
import { pasted } from "./pasted";

// Add a space, a sheet over the Spaces tab: joining one on this server
// with an invite link, as an account already signed in. The link is
// checked as it is pasted and the card says what it invites to before
// Join commits anything, as the Invite screen does for someone not yet
// on the server; a join the server then refuses is said in its own
// words. An invite to a space the account is already in says so, and
// the button goes there. Once joined, the sheet stays up ("Joining…") until the tab
// under it holds the space, and closes on it; a tab that takes too long
// picks the space when it does answer. A link to another server is only
// named for now.

// As the Invite screen: long enough not to ask about a half-pasted link.
const SETTLE_MS = 600;
// How long the sheet waits for the tab to show the joined space before
// closing anyway.
const LAND_MS = 5000;

export default function AddSpace({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const router = useRouter();
  const pushOnce = usePushOnce();
  const store = useLastSpaceStore();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  // Whether the account is already in the space the invite is to.
  const [member, setMember] = useState(false);
  // The host a pasted link is for, when it isn't this server's.
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // Why the join didn't happen, as a sentence: the server's words for a
  // refusal come without a stop, and here they are a card's body.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  // Whether a join is out (a ref, so a second tap before the redraw
  // sends nothing), and whether the sheet is still up: closed while one
  // is out (Cancel, a swipe down, Android's back), the join still
  // happens and the space turns up on the rail, but nothing is picked
  // and nothing on top by then is closed. `landing` is the space the
  // tab has been asked for and not yet answered about: closing the
  // sheet then takes the question back.
  const joiningNow = useRef(false);
  const open = useRef(true);
  const landing = useRef<string | null>(null);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      if (landing.current) withdraw(store, server.id, landing.current);
    };
  }, [store, server.id]);

  useEffect(() => {
    const what = pasted(text, server.origin);
    if (what.kind === "empty") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (what.kind === "not-link") return setCheck({ state: "not-link" });
      if (what.kind === "elsewhere") return setElsewhere(hostOf(what.origin));
      setCheck({ state: "checking" });
      const token = await sessionToken(server.id).catch(() => null);
      if (controller.signal.aborted) return;
      if (!token) return setEnded(true);
      // The account's spaces are asked for beside the invite, to say when
      // it is already in the one invited to. Not knowing (the list didn't
      // load) is taken for not being in it: Join then lands there anyway.
      const [found, mine] = await Promise.all([
        findInvite(server.origin, token, what.code, controller.signal),
        loadSpaces(server.origin, token, controller.signal).catch(() => []),
      ]);
      if (controller.signal.aborted) return;
      setMember(found.kind === "found" && mine.some((space) => space.id === found.preview.spaceId));
      setCheck({
        state: "done",
        result:
          found.kind === "found"
            ? {
                kind: "found",
                origin: server.origin,
                code: what.code,
                serverName: server.name,
                preview: found.preview,
                canCreate: false,
              }
            : found,
      });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, server.id, server.origin, server.name]);

  const found = check.state === "done" && check.result.kind === "found" ? check.result : null;
  const spaceName = found?.preview.spaceName;
  // iOS reads nothing out when the card appears under a focused field
  // (the card's live region is Android's), so it is said.
  useEffect(() => {
    if (spaceName && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        member ? `You're already in ${spaceName}.` : `You're invited to ${spaceName}. Join is ready.`,
      );
    }
  }, [spaceName, member]);

  // The tab is asked for the space and the sheet closes on it, as after
  // a join: by the space's own id here, nothing having been joined.
  const land = async (spaceId: string) => {
    landing.current = spaceId;
    const how = await landOn(store, server.id, spaceId, LAND_MS);
    // Whatever asked for another space meanwhile closes the sheet itself.
    if (!open.current || how === "replaced") return;
    landing.current = null;
    router.dismiss();
  };

  const join = async () => {
    if (!found || joiningNow.current) return;
    joiningNow.current = true;
    setJoining(true);
    setRefusal(null);
    if (member) return land(found.preview.spaceId);
    const token = await sessionToken(server.id).catch(() => null);
    const outcome = token ? await joinSpace(server.origin, token, found.code) : ({ kind: "ended" } as const);
    if (!open.current) return;
    if (outcome.kind === "joined") return land(outcome.spaceId);
    joiningNow.current = false;
    setJoining(false);
    if (outcome.kind === "ended") setEnded(true);
    else if (outcome.kind === "refused") setRefusal(stopped(sentence(outcome.message)));
    else setRefusal(`Couldn't reach ${hostOf(server.origin)}.`);
  };

  const canJoin = !!found && !joining;
  const goTo = `Go to ${spaceName ?? "the space"}`;

  return (
    <View style={[styles.screen, { paddingBottom: (keyboard || insets.bottom) + 8 }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.dismiss()} style={styles.headerButton}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          Add a space
        </Text>
        <View style={styles.headerButton} />
      </View>

      {ended ? (
        <TabNotice
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () =>
              pushOnce(() => {
                router.dismiss();
                router.push({ pathname: "/sign-in", params: { server: server.origin } });
              }),
          }}
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.main} keyboardShouldPersistTaps="handled">
            <View style={styles.field}>
              <Text style={styles.label} nativeID="add-space-link">
                Invite link
              </Text>
              <TextInput
                value={text}
                onChangeText={(next) => {
                  // The field stays editable while a join is out (locking it
                  // would drop the keyboard and the button with it), but what
                  // is being joined doesn't change under it. A result belongs
                  // to the link it was asked about.
                  if (joiningNow.current) return;
                  setText(next);
                  setCheck({ state: "idle" });
                  setMember(false);
                  setElsewhere(null);
                  setRefusal(null);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                accessibilityLabel="Invite link"
                testID="add-space-link"
                accessibilityLabelledBy="add-space-link"
                placeholder="https://chat.example.org/join/…"
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
            <InviteCard check={check} member={member} />
            {elsewhere && (
              <InviteNotice tone="plain" heading="That invite is for another server" body={`It's for ${elsewhere}.`} />
            )}
            {refusal && <InviteNotice heading="Couldn't join the space" body={refusal} />}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={member ? goTo : joining ? "Joining" : "Join space"}
              accessibilityState={{ disabled: !canJoin, busy: joining }}
              disabled={!canJoin}
              onPress={join}
              testID="add-space-join"
              style={({ pressed }) => [styles.button, !found && styles.disabled, pressed && styles.pressed]}
            >
              {joining && !member && <ActivityIndicator color={theme.onAccent} />}
              <Text style={styles.buttonLabel} numberOfLines={1}>
                {member ? goTo : joining ? "Joining…" : "Join"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      paddingTop: 8,
      backgroundColor: theme.surface,
    },
    // As New message's: Cancel, the title, and Cancel's width again so
    // the title sits in the middle.
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 44,
      paddingHorizontal: 8,
    },
    headerButton: {
      minWidth: 60,
      height: 44,
      paddingHorizontal: 8,
      justifyContent: "center",
    },
    cancel: {
      color: theme.accent,
      fontSize: tokens.textBody,
    },
    title: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "700",
    },
    main: {
      gap: 18,
      paddingTop: 16,
      paddingHorizontal: 24,
      paddingBottom: 24,
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
      flexDirection: "row",
      gap: 10,
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
