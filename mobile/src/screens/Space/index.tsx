import { Code, ConnectError } from "@connectrpc/connect";
import { Stack, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadSpaceChannels, memberName, type SpaceChannels, touchesSpace } from "../../api/channels";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import { useSignInAgain } from "../../hooks/useSignInAgain";
import { useServerEvents, useVoiceRoster } from "../../realtime/RealtimeProvider";
import { inRoom } from "../../realtime/voice";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelRow from "./ChannelRow";
import SpaceTitle from "./SpaceTitle";
import VoiceRoom from "./VoiceRoom";

// A space's channels, pushed over the Spaces tab: the space's name and
// what it is in the header's pill (SpaceTitle), which floats over the
// list beside the back button as the channel's does, its text channels
// with what is waiting in each (each opens the channel), and its voice
// rooms with who is in them. Loaded on
// opening, on a pull, on coming back to the app, and again whenever the
// realtime socket says something here changed; who is in voice is live
// from the socket itself.

const RELOAD_DELAY_MS = 300;

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; channels: SpaceChannels }
  // As the Spaces tab: only the server saying the session is over counts
  // as signed out.
  | { state: "ended" }
  // Left, removed, or the space deleted since the list was loaded.
  | { state: "gone" }
  | { state: "failed" };

export default function Space({ server, spaceId }: { server: SavedServer; spaceId: string }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const signInAgain = useSignInAgain(server.origin);
  const roster = useVoiceRoster(server.id);
  // The header floats over the screen (the Spaces stack's layout), so
  // the list and what stands in for it clear it by this much.
  const headerHeight = useHeaderHeight();
  const [view, setView] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<State> => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return { state: "ended" };
    try {
      return { state: "ready", token, channels: await loadSpaceChannels(server.origin, token, spaceId) };
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return { state: "ended" };
      if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) {
        return { state: "gone" };
      }
      return { state: "failed" };
    }
  }, [server, spaceId]);

  // Loads can overlap (opening, a pull, coming back, an event), and an
  // older one finishing last must not undo a newer one: only the latest
  // started is shown, and leaving the screen makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const next = await load();
    if (mine === latest.current) setView(next);
  }, [load]);

  // Events come in bursts (a channel deleted is also its messages' reads
  // and mentions gone), so a moment's quiet goes before one reload.
  const reload = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => {
      latest.current++;
      sub.remove();
      clearTimeout(reload.current);
    };
  }, [refresh]);
  useServerEvents(server.id, (event) => {
    if (event.payload.case === "credentialRevoked") {
      latest.current++;
      clearTimeout(reload.current);
      setView({ state: "ended" });
      return;
    }
    if (!touchesSpace(event, spaceId)) return;
    clearTimeout(reload.current);
    reload.current = setTimeout(refresh, RELOAD_DELAY_MS);
  });

  const pull = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const retry = async () => {
    setView({ state: "loading" });
    await refresh();
  };

  // The title is rebuilt only when what it says changes, not on every
  // reload that brings the same space back.
  const ready = view.state === "ready" ? view : undefined;
  const name = ready?.channels.space.name;
  const iconFileId = ready?.channels.space.iconFileId;
  const description = ready?.channels.space.description;
  const memberCount = ready?.channels.memberCount;
  const token = ready?.token;
  const options = useMemo(() => {
    if (name === undefined || iconFileId === undefined || memberCount === undefined || token === undefined) return {};
    const about = [memberCount === 1 ? "1 member" : `${memberCount} members`, description].filter(Boolean).join(" · ");
    return {
      headerTitle: () => (
        <SpaceTitle name={name} about={about} iconFileId={iconFileId} origin={server.origin} token={token} />
      ),
    };
  }, [name, iconFileId, description, memberCount, token, server.origin]);

  if (view.state === "loading") {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={{ marginTop: 24 + headerHeight }} color={theme.textMuted} />
      </View>
    );
  }
  if (view.state !== "ready") {
    return (
      <View style={styles.screen}>
        <View style={[styles.notice, { marginTop: 8 + headerHeight }]} accessibilityRole="alert">
          {view.state === "ended" && (
            <>
              <Text style={styles.body}>Your sign-in to {server.name} has ended. Sign in again to carry on.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={signInAgain}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <Text style={styles.buttonLabel}>Sign in again</Text>
              </Pressable>
            </>
          )}
          {view.state === "gone" && <Text style={styles.body}>You're no longer in this space.</Text>}
          {view.state === "failed" && (
            <>
              <Text style={styles.body}>Couldn't reach {hostOf(server.origin)}.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <Text style={styles.buttonLabel}>Try again</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  const { space, text, voice, members } = view.channels;

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: 12 + headerHeight }]}
        scrollIndicatorInsets={{ top: headerHeight }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={pull}
            tintColor={theme.textMuted}
            progressViewOffset={headerHeight}
          />
        }
      >
        {text.length > 0 && (
          <Text style={styles.section} accessibilityRole="header">
            Text channels
          </Text>
        )}
        {text.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            spaceMuted={space.muted}
            onPress={() => router.push(`/s/${server.id}/space/${spaceId}/channel/${channel.id}`)}
          />
        ))}
        {voice.length > 0 && (
          <Text style={[styles.section, styles.later]} accessibilityRole="header">
            Voice
          </Text>
        )}
        {voice.map((channel) => (
          <VoiceRoom
            key={channel.id}
            channel={channel}
            people={
              roster &&
              inRoom(roster, channel.id).map((participant) => {
                const member = members[participant.userId];
                // Someone the member list doesn't have yet: joined since it loaded.
                return member
                  ? { userId: participant.userId, name: memberName(member), avatarFileId: member.avatarFileId }
                  : { userId: participant.userId, name: "Someone", avatarFileId: "" };
              })
            }
            origin={server.origin}
            token={view.token}
          />
        ))}
        {text.length === 0 && voice.length === 0 && (
          <Text style={[styles.body, styles.empty]}>No channels here yet.</Text>
        )}
      </ScrollView>
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    content: {
      paddingHorizontal: 8,
      paddingBottom: 24,
    },
    section: {
      marginTop: 8,
      marginBottom: 4,
      marginHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textXs,
      fontWeight: "600",
      letterSpacing: 0.66,
      textTransform: "uppercase",
    },
    later: {
      marginTop: 20,
    },
    notice: {
      gap: 12,
      paddingHorizontal: 20,
    },
    body: {
      color: theme.text,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
    empty: {
      paddingHorizontal: 12,
      color: theme.textMuted,
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
