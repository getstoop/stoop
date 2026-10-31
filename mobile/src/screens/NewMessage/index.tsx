import { Code, ConnectError } from "@connectrpc/connect";
import { filterCandidates } from "@stoop/core/candidates";
import type { MessageAuthor } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { loadCandidates, MAX_PARTICIPANTS, openConversation } from "../../api/conversations";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import TabNotice from "../../components/TabNotice";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import { channelRoute } from "../Channel/routes";
import CandidateRow from "./CandidateRow";
import PickedChip from "./PickedChip";

// New message, a sheet over the Messages tab: who to talk to, picked from
// the people this account shares a space with on the server, narrowed by
// what is typed in the To line, as web's New conversation. One person or
// up to nine: a conversation is its people, so Start opens the one that
// already exists with them, or a new one, in place of this sheet. Two or
// more make a group, which is for good, and the line under the list says
// so. Once nine are picked the rest are dimmed.

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; people: MessageAuthor[] }
  | { state: "ended" }
  | { state: "failed" };

export default function NewMessage({ server }: { server: SavedServer }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [view, setView] = useState<State>({ state: "loading" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MessageAuthor[]>([]);
  const [starting, setStarting] = useState(false);
  const [refused, setRefused] = useState(false);
  // Whether a Start is out (a ref, so a second tap before the redraw
  // sends nothing), and whether the sheet is still up: closed while one
  // is out (Cancel, a swipe down, Android's back), its answer goes
  // nowhere, rather than closing whatever is on top by then.
  const startingNow = useRef(false);
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return setView({ state: "ended" });
    try {
      setView({ state: "ready", token, people: await loadCandidates(server.origin, token) });
    } catch (err) {
      setView(ended(err) ? { state: "ended" } : { state: "failed" });
    }
  }, [server]);
  useEffect(() => {
    void load();
  }, [load]);

  // A pick from the list clears what was typed to find them, so the next
  // name starts afresh; a chip's cross only takes them out.
  const remove = useCallback((person: MessageAuthor) => {
    setRefused(false);
    setPicked((held) => held.filter((p) => p.id !== person.id));
  }, []);
  const toggle = useCallback(
    (person: MessageAuthor) => {
      if (picked.some((p) => p.id === person.id)) return remove(person);
      setRefused(false);
      setQuery("");
      setPicked((held) => (held.some((p) => p.id === person.id) ? held : [...held, person]));
    },
    [picked, remove],
  );

  const ready = view.state === "ready" ? view : null;
  const start = async () => {
    if (!ready || picked.length === 0 || startingNow.current) return;
    startingNow.current = true;
    setStarting(true);
    setRefused(false);
    try {
      const channelId = await openConversation(
        server.origin,
        ready.token,
        picked.map((p) => p.id),
      );
      if (!open.current) return;
      router.dismiss();
      router.push(channelRoute(server.id, "", channelId));
    } catch {
      startingNow.current = false;
      if (!open.current) return;
      setStarting(false);
      setRefused(true);
    }
  };

  const full = picked.length >= MAX_PARTICIPANTS - 1;
  const pickedIds = new Set(picked.map((p) => p.id));
  const shown = ready ? filterCandidates(ready.people, query) : [];
  const canStart = !!ready && picked.length > 0 && !starting;
  let note = "Add more than one person to start a group.";
  if (picked.length > 1) note = "Everyone picked is in it for good: nobody can be added later, and nobody can leave.";
  if (full) note = `A conversation holds ${MAX_PARTICIPANTS} people at most. ${note}`;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.dismiss()} style={styles.headerButton}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          New message
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start"
          accessibilityState={{ disabled: !canStart, busy: starting }}
          disabled={!canStart}
          onPress={start}
          testID="start-conversation"
          style={styles.headerButton}
        >
          {starting ? (
            <ActivityIndicator color={theme.textMuted} />
          ) : (
            <Text style={[styles.start, !canStart && styles.startOff]}>Start</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.to}>
        <Text style={styles.toLabel}>To:</Text>
        {picked.map((person) => (
          <PickedChip key={person.id} person={person} onRemove={remove} />
        ))}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Add someone"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Add someone"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          testID="new-message-to"
          style={styles.input}
        />
      </View>

      {refused && (
        <Text style={styles.refused} accessibilityRole="alert">
          Couldn't start the conversation.
        </Text>
      )}

      {view.state === "loading" && <ActivityIndicator style={styles.center} color={theme.textMuted} />}
      {view.state === "ended" && (
        <TabNotice
          message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
          action={{
            label: "Sign in again",
            onPress: () => {
              router.dismiss();
              router.replace({ pathname: "/sign-in", params: { server: server.origin } });
            },
          }}
        />
      )}
      {view.state === "failed" && (
        <TabNotice
          message={`Couldn't reach ${hostOf(server.origin)}.`}
          action={{
            label: "Try again",
            onPress: () => {
              setView({ state: "loading" });
              void load();
            },
          }}
        />
      )}
      {ready && (
        <FlatList
          data={shown}
          keyExtractor={(person) => person.id}
          keyboardShouldPersistTaps="handled"
          // The keyboard takes the bottom of the sheet: the list's last rows
          // and the note under it scroll clear of it, and a drag puts it away.
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            shown.length > 0 ? <Text style={styles.eyebrow}>People on {server.name}</Text> : undefined
          }
          renderItem={({ item }) => (
            <CandidateRow
              person={item}
              picked={pickedIds.has(item.id)}
              full={full}
              origin={server.origin}
              token={ready.token}
              onToggle={toggle}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {ready.people.length === 0
                ? "Nobody to message yet. People you share a space with show up here."
                : "No one matches that."}
            </Text>
          }
          ListFooterComponent={shown.length > 0 ? <Text style={styles.note}>{note}</Text> : undefined}
        />
      )}
    </View>
  );
}

// Only the server saying the session is over counts as signed out.
function ended(err: unknown): boolean {
  return err instanceof ConnectError && err.code === Code.Unauthenticated;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      paddingTop: 8,
      backgroundColor: theme.surface,
    },
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
    start: {
      textAlign: "right",
      color: theme.accent,
      fontSize: tokens.textBody,
      fontWeight: "700",
    },
    startOff: {
      color: theme.textMuted,
    },
    to: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    toLabel: {
      color: theme.textMuted,
      fontSize: 15,
    },
    input: {
      flexGrow: 1,
      minWidth: 120,
      height: 32,
      color: theme.text,
      fontSize: tokens.textBody,
    },
    refused: {
      marginTop: 12,
      marginHorizontal: 20,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
      overflow: "hidden",
      backgroundColor: theme.dangerSoft,
      color: theme.text,
      fontSize: tokens.textUi,
    },
    center: {
      marginTop: 32,
    },
    list: {
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 32,
    },
    eyebrow: {
      marginTop: 8,
      marginBottom: 4,
      marginHorizontal: 12,
      color: theme.textMuted,
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
    note: {
      marginTop: 12,
      marginHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: 18,
    },
    empty: {
      marginTop: 24,
      marginHorizontal: 24,
      textAlign: "center",
      color: theme.textMuted,
      fontSize: tokens.textSm,
      lineHeight: 18,
    },
  });
}
