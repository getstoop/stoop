import { useNavigation, useRouter } from "expo-router";
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
import { checkInvite, findInvite, joinSpace, sentence, stopped } from "../../api/invites";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { loadSpaces } from "../../api/spaces";
import TabNotice from "../../components/TabNotice";
import { useKeyboardHeight } from "../../hooks/useKeyboardHeight";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useLastSpaceStore } from "../../lastSpace/LastSpaceProvider";
import { type SavedServer, useServers } from "../../servers";
import { type ServerNavigation, swapServer } from "../../servers/swapServer";
import { type Theme, tokens, useTheme } from "../../theme";
import type { Check } from "../Invite";
import InviteCard from "../Invite/InviteCard";
import InviteNotice from "../Invite/InviteNotice";
import { landOn, withdraw } from "./landed";
import { inviteLink, pasted } from "./pasted";

// Add a space, a sheet over the Spaces tab: joining a space with an
// invite link, as an account already signed in. The link is checked as
// it is pasted and the card says what it invites to before Join commits
// anything, as the Invite screen does for someone not yet on the
// server; a join the server then refuses is said in its own words. An
// invite to a space the account is already in says so, and the button
// goes there.
//
// A link to this server joins here: the sheet stays up ("Joining…")
// until the tab under it holds the space, and closes on it; a tab that
// takes too long picks the space when it does answer. A link to another
// server the phone is signed in to joins there with that server's
// session, and the app then swaps to that server, on the space. A link
// to a server the phone isn't signed in to (saved or not) is checked as
// the Invite screen checks one and handed to it, to sign in or make an
// account. The web's open-in-app page hands an invite to a saved server
// here too (`initialLink`, links/OpenInviteHere.tsx), already in the
// field and checked at once.

// As the Invite screen: long enough not to ask about a half-pasted link.
const SETTLE_MS = 600;
// How long the sheet waits for the tab to show the space (joined, or
// already in) before closing anyway.
const LAND_MS = 5000;

// Where the invite that was found can be used: on a server the phone is
// signed in to (this one or another), or on one it isn't, by way of the
// Invite screen, which takes the link.
type Place = { kind: "server"; server: SavedServer } | { kind: "outside"; link: string };

export default function AddSpace({ server, initialLink = "" }: { server: SavedServer; initialLink?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const styles = makeStyles(theme);
  const router = useRouter();
  const navigation = useNavigation<ServerNavigation>();
  const pushOnce = usePushOnce();
  const store = useLastSpaceStore();
  const { servers, switchTo } = useServers();
  const [text, setText] = useState(initialLink);
  const [focused, setFocused] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [place, setPlace] = useState<Place>({ kind: "server", server });
  // Whether the account is already in the space the invite is to.
  const [member, setMember] = useState(false);
  const [joining, setJoining] = useState(false);
  // Why the join didn't happen, as a sentence: the server's words for a
  // refusal come without a stop, and here they are a card's body.
  const [refusal, setRefusal] = useState<string | null>(null);
  // The server whose sign-in turned out to have ended, and the invite
  // that was being used on it, for signing in again to carry.
  const [ended, setEnded] = useState<{ server: SavedServer; code?: string } | null>(null);
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

  // The saved servers as last told, read when a link is checked: a
  // list rebuilt under the sheet doesn't check the link again.
  const saved = useRef(servers);
  saved.current = servers;

  useEffect(() => {
    const what = pasted(text, server.origin);
    if (what.kind === "empty") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (what.kind === "not-link") return setCheck({ state: "not-link" });
      setCheck({ state: "checking" });
      setMember(false);
      const here = what.kind === "here";
      const on = saved.current.find((each) => (here ? each.id === server.id : each.origin === what.origin));
      const token = on ? await sessionToken(on.id).catch(() => null) : null;
      if (controller.signal.aborted) return;
      if (!on || !token) {
        if (here) return setEnded({ server, code: what.code });
        // Not a server the phone is signed in to: asked as a stranger
        // would, which also says whether it is a server the app can use.
        const link = { origin: what.origin, code: what.code };
        const result = await checkInvite(link, controller.signal);
        if (controller.signal.aborted) return;
        setPlace({ kind: "outside", link: inviteLink(link) });
        setCheck({ state: "done", result });
        return;
      }
      // The account's spaces are asked for beside the invite, to say when
      // it is already in the one invited to; the card doesn't wait for
      // them. Not knowing (the list didn't load) is taken for not being
      // in it: Join then lands there anyway.
      const spaces = loadSpaces(on.origin, token, controller.signal).catch(() => []);
      const found = await findInvite(on.origin, token, what.code, controller.signal);
      if (controller.signal.aborted) return;
      setPlace({ kind: "server", server: on });
      setCheck({
        state: "done",
        result:
          found.kind === "found"
            ? {
                kind: "found",
                origin: on.origin,
                code: what.code,
                serverName: on.name,
                preview: found.preview,
                canCreate: false,
              }
            : found,
      });
      if (found.kind !== "found") return;
      const mine = await spaces;
      if (controller.signal.aborted) return;
      setMember(mine.some((space) => space.id === found.preview.spaceId));
      // A link handed over by the app opens checked; one being typed waits.
    }, text === initialLink ? 0 : SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The server by what of it is used here, not its saved record, which
    // is rebuilt whenever the list is.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  }, [text, initialLink, server.id, server.origin, server.name]);

  const found = check.state === "done" && check.result.kind === "found" ? check.result : null;
  const spaceName = found?.preview.spaceName;
  const outside = place.kind === "outside";
  const there = place.kind === "server" && place.server.id !== server.id ? place.server : null;
  // What the button does, and says: hands the link to the Invite screen,
  // goes to a space the account is already in, or joins (on the other
  // server, by name, when the invite is for one).
  let action = "Join";
  if (found && outside) action = `Continue to ${found.serverName}`;
  else if (found && member) action = `Go to ${spaceName}`;
  else if (found && there) action = `Join on ${there.name}`;

  // iOS reads nothing out when the card appears under a focused field
  // (the card's live region is Android's), so it is said.
  useEffect(() => {
    if (spaceName && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        member ? `You're already in ${spaceName}.` : `You're invited to ${spaceName}. ${action} is ready.`,
      );
    }
  }, [spaceName, member, action]);

  // The tab is asked for the space and the sheet closes on it: after a
  // join, or for a space the account was already in.
  const land = async (spaceId: string) => {
    landing.current = spaceId;
    const how = await landOn(store, server.id, spaceId, LAND_MS);
    // Whatever asked for another space meanwhile closes the sheet itself.
    if (!open.current || how === "replaced") return;
    landing.current = null;
    router.dismiss();
  };

  // On another server: its Spaces tab is asked for the space, to pick it
  // as it opens, and the app swaps to that server as the switcher does,
  // which takes this sheet with the server it was over.
  const landThere = (other: SavedServer, spaceId: string) => {
    store.ask(other.id, spaceId);
    swapServer(navigation, other.id);
    switchTo(other.id).catch(() => {});
  };

  const act = async () => {
    if (!found || joiningNow.current) return;
    if (place.kind === "outside") {
      const link = place.link;
      return pushOnce(() => {
        router.dismiss();
        router.push({ pathname: "/invite", params: { link } });
      });
    }
    const on = place.server;
    const arrive = (spaceId: string) => (on.id === server.id ? land(spaceId) : landThere(on, spaceId));
    joiningNow.current = true;
    setJoining(true);
    setRefusal(null);
    if (member) return arrive(found.preview.spaceId);
    const token = await sessionToken(on.id).catch(() => null);
    const outcome = token ? await joinSpace(on.origin, token, found.code) : ({ kind: "ended" } as const);
    if (!open.current) return;
    if (outcome.kind === "joined") return arrive(outcome.spaceId);
    joiningNow.current = false;
    setJoining(false);
    if (outcome.kind === "ended") setEnded({ server: on, code: found.code });
    else if (outcome.kind === "refused") setRefusal(stopped(sentence(outcome.message)));
    else setRefusal(`Couldn't reach ${hostOf(on.origin)}.`);
  };

  const canAct = !!found && !joining;
  const waiting = joining && !member;

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
          message={`Your sign-in to ${ended.server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () =>
              pushOnce(() => {
                router.dismiss();
                // Signing in with the invite joins its space on the way
                // (SignIn's finish), so the link isn't asked for twice.
                const invite = ended.code ? { invite: ended.code } : {};
                router.push({ pathname: "/sign-in", params: { server: ended.server.origin, ...invite } });
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
                  setPlace({ kind: "server", server });
                  setMember(false);
                  setRefusal(null);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                accessibilityLabel="Invite link"
                testID="add-space-link"
                accessibilityLabelledBy="add-space-link"
                placeholder="https://chat.example.org/join/…"
                placeholderTextColor={theme.textMuted}
                autoFocus={!initialLink}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="done"
                style={[styles.input, focused && styles.inputFocused]}
              />
            </View>
            <InviteCard check={check} member={member} aside={outside ? "Not signed in to" : undefined} />
            {refusal && <InviteNotice heading="Couldn't join the space" body={refusal} />}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={waiting ? "Joining" : action === "Join" ? "Join space" : action}
              accessibilityState={{ disabled: !canAct, busy: joining }}
              disabled={!canAct}
              onPress={act}
              testID="add-space-join"
              style={({ pressed }) => [styles.button, !found && styles.disabled, pressed && styles.pressed]}
            >
              {joining && <ActivityIndicator color={theme.onAccent} />}
              <Text style={styles.buttonLabel} numberOfLines={1}>
                {waiting ? "Joining…" : action}
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
