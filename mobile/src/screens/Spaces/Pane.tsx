import { Code, ConnectError } from "@connectrpc/connect";
import type { Space } from "@stoop/gen/stoop/chat/v1/space_pb";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadSpaceChannels, memberName, type SpaceChannels, touchesSpace } from "../../api/channels";
import { hostOf } from "../../api/probe";
import { sessionToken } from "../../api/servers";
import Skeleton from "../../components/Skeleton";
import TabNotice from "../../components/TabNotice";
import { useServerEvents, useVoiceRoster } from "../../realtime/RealtimeProvider";
import { inRoom } from "../../realtime/voice";
import type { SavedServer } from "../../servers";
import { type Theme, tokens, useTheme } from "../../theme";
import ChannelRow from "./ChannelRow";
import PaneHeader from "./PaneHeader";
import PaneSkeleton from "./PaneSkeleton";
import { useQuietReload } from "./useQuietReload";
import VoiceRoom from "./VoiceRoom";

// The Spaces tab's pane: the selected space's name, how many are in it
// and what it is, with the search of it, over its text channels with
// what is waiting in each (each opens the channel) and its voice rooms
// with who is in them. The tab mounts one per space picked, so each
// starts from its skeleton, under the name the rail's list already has.
// Loaded on opening, on a pull, on coming back to the app, and again
// whenever the realtime socket says something in the space changed; who
// is in voice is live from the socket itself.

type State =
  | { state: "loading" }
  | { state: "ready"; token: string; channels: SpaceChannels }
  // Left, removed, or the space deleted since the rail's list was
  // loaded. The tab is told, and moves on to another space; until its
  // list says so too, the skeleton stays.
  | { state: "gone" }
  | { state: "failed" };

export default function Pane({
  server,
  space,
  onReloadSpaces,
  onGone,
  onEnded,
}: {
  server: SavedServer;
  // The space as the rail's list has it.
  space: Space;
  // A pull reloads the rail with the pane.
  onReloadSpaces: () => Promise<void>;
  onGone: () => void;
  // The server said the session is over: the whole tab says so.
  onEnded: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const roster = useVoiceRoster(server.id);
  const spaceId = space.id;
  const [view, setView] = useState<State>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<State | "ended"> => {
    const token = await sessionToken(server.id).catch(() => null);
    if (!token) return "ended";
    try {
      return { state: "ready", token, channels: await loadSpaceChannels(server.origin, token, spaceId) };
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return "ended";
      if (err instanceof ConnectError && (err.code === Code.NotFound || err.code === Code.PermissionDenied)) {
        return { state: "gone" };
      }
      return { state: "failed" };
    }
  }, [server, spaceId]);

  // What the load's answer is passed to, as they are on the latest draw.
  const told = useRef({ onGone, onEnded });
  told.current = { onGone, onEnded };

  // Loads can overlap (opening, a pull, coming back, an event), and an
  // older one finishing last must not undo a newer one: only the latest
  // started is shown, and leaving the pane makes none the latest.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const next = await load();
    if (mine !== latest.current) return;
    if (next === "ended") {
      told.current.onEnded();
      return;
    }
    setView(next);
    if (next.state === "gone") told.current.onGone();
  }, [load]);

  const quiet = useQuietReload(refresh);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (state) => state === "active" && refresh());
    return () => {
      latest.current++;
      sub.remove();
    };
  }, [refresh]);
  useServerEvents(server.id, (event) => {
    if (touchesSpace(event, spaceId)) quiet.soon();
  });

  const pull = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), onReloadSpaces()]);
    setRefreshing(false);
  };

  const retry = async () => {
    setView({ state: "loading" });
    await refresh();
  };

  const ready = view.state === "ready" ? view : undefined;
  const shown = ready?.channels.space ?? space;
  const about =
    ready &&
    [ready.channels.memberCount === 1 ? "1 member" : `${ready.channels.memberCount} members`, shown.description]
      .filter(Boolean)
      .join(" · ");

  const header = (
    <PaneHeader
      name={shown.name}
      about={about}
      onSearch={() =>
        router.push({ pathname: "/s/[id]/space/[spaceId]/search", params: { id: server.id, spaceId } })
      }
    />
  );

  if (view.state === "failed") {
    return (
      <>
        {header}
        <TabNotice
          message={`Couldn't reach ${hostOf(server.origin)}.`}
          action={{ label: "Try again", onPress: retry }}
        />
      </>
    );
  }
  if (!ready) {
    return (
      <>
        {header}
        <Skeleton>
          <PaneSkeleton />
        </Skeleton>
      </>
    );
  }

  const { text, voice, members } = ready.channels;

  return (
    <>
      {header}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.content}
        // The tab bar lies over the bottom of the screen on iOS: the
        // system insets the list by it, so the last row scrolls clear.
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.textMuted} />}
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
            spaceMuted={shown.muted}
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
            token={ready.token}
          />
        ))}
        {text.length === 0 && voice.length === 0 && <Text style={styles.empty}>No channels here yet.</Text>}
      </ScrollView>
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    list: {
      flex: 1,
    },
    content: {
      paddingTop: 4,
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
    empty: {
      paddingHorizontal: 12,
      color: theme.textMuted,
      fontSize: tokens.textBody,
      lineHeight: tokens.textBody * tokens.leadingBody,
    },
  });
}
