import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/experimental";
import { setChannelMuted } from "../../api/channels";
import { errorText } from "../../api/errors";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useVoiceRoster } from "../../realtime/RealtimeProvider";
import { inRoom } from "../../realtime/voice";
import type { SavedServer } from "../../servers";
import { type Theme, useTheme } from "../../theme";
import ChannelOutcome from "../Channel/ChannelOutcome";
import EdgeBlur from "../Channel/EdgeBlur";
import EdgeFade from "../Channel/EdgeFade";
import { channelMute } from "../Channel/headerActions";
import ScreenHeader, { useHeaderClearance } from "../Channel/ScreenHeader";
import Stage from "./Stage";
import StageFoot from "./StageFoot";
import { hereLine, stagePeople } from "./stageRules";
import { useVoiceRoom } from "./useVoiceRoom";
import VoiceTitle from "./VoiceTitle";

// A voice room, pushed over its space (the room's row on the Spaces
// tab opens it): the Stage, a tile for everyone in the room, live from
// the socket's roster, under a channel's floating header (ScreenHeader)
// titled with the room, its space and how many are here, and over a
// foot that names them above Join. The app can't join a call yet
// (STOOPMOBIL-48), so Join is inert and nobody here is ever "you".
// Search in the header searches the room's space; the bell mutes the
// room, or unmutes it, as its row's menu does. The room and its space
// are useVoiceRoom's.
export default function VoiceRoom({
  server,
  spaceId,
  channelId,
}: {
  server: SavedServer;
  spaceId: string;
  channelId: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderClearance();
  const router = useRouter();
  const pushOnce = usePushOnce();
  const roster = useVoiceRoster(server.id);
  const { view, reload, retry } = useVoiceRoom(server, spaceId, channelId);
  const [footHeight, setFootHeight] = useState(0);

  const openSearch = useCallback(
    () => pushOnce(() => router.push({ pathname: "/s/[id]/space/[spaceId]/search", params: { id: server.id, spaceId } })),
    [pushOnce, router, server.id, spaceId],
  );

  // A mute asked for: the bell waits for the server's answer and the
  // reload that shows it, and a second tap meanwhile does nothing.
  const [muting, setMuting] = useState(false);
  const mutingNow = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const ready = view.state === "ready" ? view : undefined;
  const toggleMute = () => {
    if (mutingNow.current || !ready) return;
    const muted = !ready.channel.muted;
    mutingNow.current = true;
    setMuting(true);
    setChannelMuted(server.origin, ready.token, channelId, muted)
      .then(reload, (err) => {
        if (alive.current) Alert.alert(muted ? "Couldn't mute the channel" : "Couldn't unmute the channel", errorText(err));
      })
      .finally(() => {
        mutingNow.current = false;
        if (alive.current) setMuting(false);
      });
  };

  // Who is in the room, or undefined while the socket hasn't said, in
  // the roster's order: as they joined, as far as the app has seen
  // (realtime/voice).
  const people = ready && roster ? stagePeople(inRoom(roster, channelId), ready.members) : undefined;

  const top = (
    <ScreenHeader
      title={ready && <VoiceTitle name={ready.channel.name} spaceName={ready.space.name} count={people?.length} />}
      search={ready ? { spaceName: ready.space.name, onPress: openSearch } : undefined}
      mute={
        ready
          ? { ...channelMute("channel", ready.channel.muted, ready.space.muted), pending: muting, onPress: toggleMute }
          : undefined
      }
    />
  );

  if (view.state === "loading") {
    return (
      <View style={styles.screen}>
        {top}
        <ActivityIndicator style={{ marginTop: 24 + headerHeight }} color={theme.textMuted} />
      </View>
    );
  }
  if (view.state !== "ready") {
    return (
      <View style={styles.screen}>
        {top}
        <ChannelOutcome outcome={view.state} server={server} spaceId={spaceId} onRetry={retry} />
      </View>
    );
  }

  const stage = (
    <Stage people={people} origin={server.origin} token={view.token} top={headerHeight} bottom={footHeight} />
  );
  const Edge = Platform.OS === "ios" && isLiquidGlassAvailable() ? EdgeBlur : EdgeFade;

  return (
    <View style={styles.screen}>
      {top}
      {/* As a channel's list (ComposerDock): no system fade under the
          status bar on iOS 26, and the app's own edge there instead. */}
      {Platform.OS === "ios" ? (
        <ScrollViewMarker style={styles.fill} scrollEdgeEffects={noFade}>
          {stage}
        </ScrollViewMarker>
      ) : (
        stage
      )}
      <Edge edge="top" height={insets.top + FADE_IN} />
      <StageFoot line={hereLine(people?.map((person) => person.name) ?? [])} onHeight={setFootHeight} />
    </View>
  );
}

const noFade = { top: "hidden", bottom: "hidden", left: "hidden", right: "hidden" } as const;

// How far past the status bar the top edge reaches, as a channel's.
const FADE_IN = 20;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.surface,
    },
    fill: {
      flex: 1,
    },
  });
}
