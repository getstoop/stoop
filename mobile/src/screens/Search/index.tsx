import { Code, ConnectError } from "@connectrpc/connect";
import { inChannel, toggleInChannel } from "@stoop/core/search";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hostOf } from "../../api/probe";
import { loadSearchScope, type SearchScope } from "../../api/search";
import { sessionToken } from "../../api/servers";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import EdgeFade from "../Channel/EdgeFade";
import Unavailable from "../Channel/Unavailable";
import { noMatchParts } from "./noMatch";
import ResultRow from "./ResultRow";
import ScopeRow from "./ScopeRow";
import SearchHeader from "./SearchHeader";
import { type SearchState, useSearch } from "./useSearch";

// A space's messages searched, pushed over a channel or a thread: web's
// search page on the phone. Its own header floats over the list (the
// server's layout hides the native one): a round back button and the
// field's pill, which arrives narrowed to the channel the search started
// from (`channelId`, the in:#name filter in the field, core/search) with
// the keyboard up, or holding a query given to run (`query`). The return
// key runs the search; the server parses the words
// (docs/architecture/messaging.md → Search). Under the header, two chips
// widen it to the whole space or narrow it back, and the count of what
// matched. The matches come newest first, each row the author, the
// channel, the day and the words (ResultRow); reaching the end asks for
// the older page while the server has one, and a new search drops the
// older pages (useSearch). A tap on a row pushes the message's channel
// with `focus` naming the message; the channel doesn't act on it yet.
// With nothing searched the hint says what the query takes; a search
// that found nothing says so, and offers the whole space when it was
// narrowed to a channel; a refusal is said in the server's words, or
// core's for its guards.

type ScopeState =
  | { state: "loading" }
  | { state: "ready"; token: string; scope: SearchScope }
  // As the space's screen: only the server saying the session is over
  // counts as signed out.
  | { state: "ended" }
  | { state: "failed" };

export default function Search({
  server,
  spaceId,
  channelId,
  query,
}: {
  server: SavedServer;
  spaceId: string;
  channelId?: string;
  query?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<ScopeState>({ state: "loading" });
  // The header's height as drawn, for the list to clear.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [draft, setDraft] = useState(query ?? "");
  const token = view.state === "ready" ? view.token : null;
  const { state, run, more } = useSearch(server.origin, token, spaceId);

  const load = useCallback(async (): Promise<ScopeState> => {
    const session = await sessionToken(server.id).catch(() => null);
    if (!session) return { state: "ended" };
    try {
      return { state: "ready", token: session, scope: await loadSearchScope(server.origin, session, spaceId) };
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return { state: "ended" };
      return { state: "failed" };
    }
  }, [server, spaceId]);
  // One load at a time, the latest started the one shown; leaving the
  // screen makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const next = await load();
    if (mine === latest.current) setView(next);
  }, [load]);
  useEffect(() => {
    refresh();
    return () => {
      latest.current++;
    };
  }, [refresh]);
  const retry = () => {
    setView({ state: "loading" });
    refresh();
  };

  const channels = view.state === "ready" ? view.scope.channels : undefined;
  const from = channelId ? channels?.find((channel) => channel.id === channelId) : undefined;
  const channelNames = useMemo(
    () => new Map<string, string>(channels?.map((channel) => [channel.id, channel.name] as const)),
    [channels],
  );

  // Once the space is known: a query given runs; otherwise the field
  // starts narrowed to the channel the search started from.
  const started = useRef(false);
  useEffect(() => {
    if (view.state !== "ready" || started.current) return;
    started.current = true;
    if (query) run(query);
    else if (from) setDraft(`${toggleInChannel("", from.name)} `);
  }, [view.state, query, from, run]);

  const narrowed = !!from && inChannel(draft, from.name);
  // A chip rewrites the field and runs what it leaves.
  const retarget = (next: string) => {
    setDraft(next);
    run(next);
  };
  const open = useCallback(
    (message: Message) =>
      router.push({
        pathname: "/s/[id]/space/[spaceId]/channel/[channelId]",
        params: { id: server.id, spaceId, channelId: message.channelId, focus: message.id },
      }),
    [router, server.id, spaceId],
  );

  const spaceName = view.state === "ready" ? view.scope.space.name : server.name;
  const header = (
    <SearchHeader
      spaceName={spaceName}
      draft={draft}
      autoFocus={!query}
      onChange={setDraft}
      onSubmit={() => run(draft)}
      onBack={() => router.back()}
      onLayout={setHeaderHeight}
    />
  );

  if (view.state === "loading") {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={{ marginTop: headerHeight + 24 }} color={theme.textMuted} />
        {header}
      </View>
    );
  }
  if (view.state !== "ready") {
    return (
      <View style={styles.screen}>
        <View style={[styles.fill, { paddingTop: headerHeight }]}>
          {view.state === "ended" ? (
            <Unavailable
              message={`Your sign-in to ${server.name} has ended. Sign in again to carry on.`}
              action={{
                label: "Sign in again",
                onPress: () => router.replace({ pathname: "/sign-in", params: { server: server.origin } }),
              }}
            />
          ) : (
            <Unavailable message={`Couldn't reach ${hostOf(server.origin)}.`} action={{ label: "Try again", onPress: retry }} />
          )}
        </View>
        {header}
      </View>
    );
  }

  const { results } = state;
  const found = results?.messages.length ?? 0;
  const count = results ? `${found}${results.hasOlder ? "+" : ""} ${found === 1 && !results.hasOlder ? "message" : "messages"}` : "";

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          data={results?.messages ?? NO_MESSAGES}
          keyExtractor={(message) => message.id}
          renderItem={({ item }) => (
            <ResultRow
              message={item}
              channelName={channelNames.get(item.channelId) ?? "…"}
              myUserId={view.scope.myUserId}
              origin={server.origin}
              token={view.token}
              onPress={open}
            />
          )}
          ListHeaderComponent={
            <ScopeRow
              channelName={from?.name}
              narrowed={narrowed}
              count={count}
              onAll={() => from && narrowed && retarget(toggleInChannel(draft, from.name))}
              onThis={() => from && !narrowed && retarget(toggleInChannel(draft, from.name))}
            />
          }
          ListEmptyComponent={<Empty state={state} />}
          ListFooterComponent={
            state.loadingMore ? (
              <Text style={styles.hint}>Loading older matches…</Text>
            ) : state.error && results ? (
              <Text style={styles.error} accessibilityRole="alert">
                {state.error}
              </Text>
            ) : undefined
          }
          onEndReached={more}
          onEndReachedThreshold={0.5}
          // As the channel's: scrolling leaves the keyboard in place (on
          // iOS a drag down into it puts it away), and a tap on a row
          // works with the keyboard up.
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: insets.bottom + 16 }}
        />
      </KeyboardAvoidingView>
      <EdgeFade edge="top" height={insets.top + 20} />
      {header}
    </View>
  );
}

const NO_MESSAGES: Message[] = [];

// What stands where the matches would be: the hint before a search,
// "Searching…" while the first page is out, what matched nothing, or
// why the search failed.
function Empty({ state }: { state: SearchState }) {
  const styles = makeStyles(useTheme());
  if (state.error) {
    return (
      <Text style={styles.error} accessibilityRole="alert">
        {state.error}
      </Text>
    );
  }
  if (state.searching) return <Text style={styles.hint}>Searching…</Text>;
  if (!state.query) {
    return (
      <Text style={styles.hint}>
        Type a word and press Search. Quote “a phrase”, put - before a word to leave it out, or narrow with from:@name,
        in:#channel, before:2026-01-31 and after:2026-01-01.
      </Text>
    );
  }
  if (!state.results) return null;
  const { words, channel } = noMatchParts(state.query);
  return (
    <>
      <Text style={styles.hint}>
        No messages match <Text style={styles.strong}>{words}</Text>
        {channel ? ` in #${channel}` : ""}.
      </Text>
      {channel && <Text style={styles.hint}>Try all channels, or fewer words.</Text>}
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    fill: {
      flex: 1,
    },
    hint: {
      marginHorizontal: 16,
      marginVertical: 8,
      color: theme.textMuted,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
    strong: {
      color: theme.text,
      fontWeight: "700",
    },
    error: {
      marginHorizontal: 16,
      marginVertical: 8,
      color: theme.danger,
      fontSize: tokens.textUi,
      lineHeight: tokens.textUi * tokens.leadingUi,
    },
  });
}
