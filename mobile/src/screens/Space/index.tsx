import { Code, ConnectError } from "@connectrpc/connect";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadSpaceChannels, memberName, type SpaceChannels, touchesSpace } from "../../api/channels";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import SpaceIcon from "../../components/SpaceIcon";
import { useServerEvents, useVoiceRoster } from "../../realtime/RealtimeProvider";
import { inRoom } from "../../realtime/voice";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelRow from "./ChannelRow";
import VoiceRoom from "./VoiceRoom";

// A space's channels, pushed over the Spaces tab: the space's name and
// what it is, its text channels with what is waiting in each, and its
// voice rooms with who is in them. Loaded on opening, on a pull, on
// coming back to the app, and again whenever the realtime socket says
// something here changed; who is in voice is live from the socket itself.

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
  const roster = useVoiceRoster(server.id);
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

  // Events come in bursts (a channel deleted is also its messages' reads
  // and mentions gone), so a moment's quiet goes before one reload.
  const reload = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const refresh = () => load().then((next) => live && setView(next));
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => {
      live = false;
      sub.remove();
      clearTimeout(reload.current);
    };
  }, [load]);
  useServerEvents(server.id, (event) => {
    if (!touchesSpace(event, spaceId)) return;
    clearTimeout(reload.current);
    reload.current = setTimeout(() => load().then(setView), RELOAD_DELAY_MS);
  });

  const pull = async () => {
    setRefreshing(true);
    setView(await load());
    setRefreshing(false);
  };

  const retry = async () => {
    setView({ state: "loading" });
    setView(await load());
  };

  if (view.state === "loading") {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={styles.center} color={theme.textMuted} />
      </View>
    );
  }
  if (view.state !== "ready") {
    return (
      <View style={styles.screen}>
        <View style={styles.notice} accessibilityRole="alert">
          {view.state === "ended" && (
            <>
              <Text style={styles.body}>Your sign-in to {server.name} has ended. Sign in again to carry on.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace({ pathname: "/sign-in", params: { server: server.origin } })}
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

  const { space, text, voice, mentions, members, memberCount } = view.channels;
  const about = [memberCount === 1 ? "1 member" : `${memberCount} members`, space.description]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}
    >
      <View style={styles.header}>
        <SpaceIcon name={space.name} fileId={space.iconFileId} origin={server.origin} token={view.token} size={48} />
        <View style={styles.titles}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {space.name}
          </Text>
          <Text style={styles.about} numberOfLines={2}>
            {about}
          </Text>
        </View>
      </View>
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
          mentions={mentions[channel.id] ?? 0}
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
    center: {
      marginTop: 24,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingTop: 4,
      paddingBottom: 16,
      paddingHorizontal: 12,
    },
    titles: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: theme.text,
      fontSize: tokens.textXl,
      lineHeight: tokens.textXl * tokens.leadingTight,
      fontWeight: "700",
    },
    about: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
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
      marginTop: 8,
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
