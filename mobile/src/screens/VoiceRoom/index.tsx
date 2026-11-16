import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/experimental";
import { setChannelMuted } from "../../api/channels";
import { errorText } from "../../api/errors";
import { useCall, useCallActions } from "../../call/CallProvider";
import { failureLine, footState, speakerState } from "../../call/call";
import { usePushOnce } from "../../hooks/usePushOnce";
import { useVoiceRoster } from "../../realtime/RealtimeProvider";
import { inRoom } from "../../realtime/voice";
import type { SavedServer } from "../../servers";
import { type Theme, useTheme } from "../../theme";
import Channel from "../Channel";
import ChannelOutcome from "../Channel/ChannelOutcome";
import EdgeBlur from "../Channel/EdgeBlur";
import EdgeFade from "../Channel/EdgeFade";
import { channelMute } from "../Channel/headerActions";
import ScreenHeader, { useHeaderClearance, useHeaderReach } from "../Channel/ScreenHeader";
import Stage from "./Stage";
import StageFoot from "./StageFoot";
import { hereLine, stagePeople } from "./stageRules";
import { chatWaiting, opensOn, type Side } from "./switchRules";
import { useVoiceRoom } from "./useVoiceRoom";
import ViewSwitch, { SWITCH_CLEARANCE } from "./ViewSwitch";
import VoiceTitle from "./VoiceTitle";

// A voice room, pushed over its space (the room's row on the Spaces
// tab opens it): a channel's floating header (ScreenHeader) titled
// with the room, its space and how many are here, a second floating
// row under it with the Call | Chat switch (ViewSwitch), and under
// both the side the switch shows.
//
// Call, which the room opens on, is the Stage: a tile for everyone in
// the room, live from the socket's roster, over a foot that names them
// above Join. Join puts the phone in the room's call, which the app
// holds above this screen (src/call): the foot then offers Mute,
// Speaker and Leave, this account is a tile like anyone, through the
// roster, and whoever is speaking wears a ring. Leaving the screen
// keeps the call, and coming back finds it.
//
// Chat is the room's own chat, which is the room's channel: the channel
// screen (screens/Channel) drawn under this header, with all a channel
// has, read and written without joining. Opening it reads it, as a
// channel. Seen from Call, Chat wears a dot while messages wait there;
// in this room's call, Call wears a green wave on both sides, and on
// Chat the call's Mute sits beside the switch (Speaker and Leave stay
// on the Stage). Opened at a message (`focusId`, the search's row), the
// room opens on Chat, at it; going to Call forgets the message.
//
// Search in the header searches the room's space narrowed to the room's
// chat; the bell mutes the room, or unmutes it, as its row's menu does.
// The room and its space are useVoiceRoom's.
export default function VoiceRoom({
  server,
  spaceId,
  channelId,
  focusId,
}: {
  server: SavedServer;
  spaceId: string;
  channelId: string;
  // The message to open the chat at, from the route.
  focusId?: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderClearance();
  // The switch starts where the header ends as drawn.
  const { reach, onReach } = useHeaderReach();
  const router = useRouter();
  const pushOnce = usePushOnce();
  const roster = useVoiceRoster(server.id);
  const { view, reload, retry } = useVoiceRoom(server, spaceId, channelId);
  const [footHeight, setFootHeight] = useState(0);

  const call = useCall();
  const { join, leave, toggleMute: toggleMic, toggleSpeaker, dismiss } = useCallActions();
  const room = useMemo(() => ({ serverId: server.id, spaceId, channelId }), [server.id, spaceId, channelId]);
  const foot = footState(call, room);
  const inCall = foot === "joined";

  // The side shown. A message to open at, also one named while the
  // room is already up (the search going back to it), shows Chat.
  const [side, setSide] = useState<Side>(() => opensOn(focusId));
  const openedAt = useRef(focusId);
  if (openedAt.current !== focusId) {
    openedAt.current = focusId;
    if (focusId) setSide("chat");
  }
  const show = (next: Side) => {
    if (next === side) return;
    Keyboard.dismiss();
    // The message Chat was opened at has been seen: Chat next opens as
    // a channel does, and the same message asked for again is news.
    if (next === "call" && focusId) router.setParams({ focus: undefined });
    setSide(next);
  };
  // A failed join is this visit's news: gone on leaving the screen.
  useEffect(() => dismiss, [dismiss]);

  const openSearch = useCallback(
    () =>
      pushOnce(() =>
        router.push({ pathname: "/s/[id]/space/[spaceId]/search", params: { id: server.id, spaceId, c: channelId } }),
      ),
    [pushOnce, router, server.id, spaceId, channelId],
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
      onReach={onReach}
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

  // Both sides start under the header and the switch.
  const clearance = reach + SWITCH_CLEARANCE;
  const stage = (
    <Stage
      people={people}
      speaking={inCall && call ? call.speaking : NOBODY}
      origin={server.origin}
      token={view.token}
      top={clearance}
      bottom={footHeight}
    />
  );
  const Edge = Platform.OS === "ios" && isLiquidGlassAvailable() ? EdgeBlur : EdgeFade;

  return (
    <View style={styles.screen}>
      {top}
      <ViewSwitch
        top={reach}
        side={side}
        inCall={inCall}
        waiting={chatWaiting(view.channel, view.space.muted, side)}
        onSide={show}
        mic={side === "chat" && inCall ? { muted: !!call?.muted, onToggle: () => void toggleMic() } : undefined}
      />
      {side === "chat" ? (
        <Channel server={server} spaceId={spaceId} channelId={channelId} focusId={focusId} under={clearance} />
      ) : (
        <>
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
          <StageFoot
            line={hereLine(people?.map((person) => person.name) ?? [])}
            failure={failureLine(call, room)}
            state={foot}
            muted={inCall && !!call?.muted}
            onJoin={() => void join(room)}
            speaker={speakerState(call)}
            onToggleMute={() => void toggleMic()}
            onToggleSpeaker={() => void toggleSpeaker()}
            onLeave={() => void leave()}
            onHeight={setFootHeight}
          />
        </>
      )}
    </View>
  );
}

const NOBODY: string[] = [];

const noFade ={ top: "hidden", bottom: "hidden", left: "hidden", right: "hidden" } as const;

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
