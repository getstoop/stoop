import { formatBytes } from "@stoop/core/attachments";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { type ComponentRef, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { fileAnswers, fileSource } from "../../api/downloads";
import { markdown, tokens, useTheme } from "../../theme";
import Card from "../Attachments/Card";
import { isUnplayable, markUnplayable } from "../Attachments/unplayable";
import { cardLabel } from "../Attachments/words";
import { FileIcon } from "../Icons";
import type { BarHeights } from "./Bars";
import type { ViewerItem } from "./items";

// A video in the viewer (expo-video: AVPlayer, ExoPlayer), fitted to the
// box between the viewer's bars (`box`), so nothing covers the
// platform's own controls. It plays, with sound, when its page is the
// one on screen (`active`), since the tap that opened it asked for that,
// and pauses when paged away from or as the viewer closes; the pager
// unmounts a page beyond its neighbours, which releases it. A page is
// given a player only once it has been on screen, so a neighbour fetches
// nothing. The file comes from /files with the session, by Range
// requests. Every touch on the video is its controls': a gesture over it
// keeps them from showing, so while a player is up (onPlayer) the pager
// pages from swipes on the bars instead, and there is no drag down to
// close. The controls' full screen button is the platform's player over
// the whole screen, which turns with the phone though the app doesn't,
// and comes back to this page. On Android it is an activity of its own,
// so the app counts as in the background while it is up: the sockets
// close and catch up on the way back.
// When the player gives up before the file has loaded, its first byte is
// asked for (after, the error is the network's: couldn't load); and on
// Android a file whose video tracks the phone says it can't decode is
// known at load. A file that answers is one this phone can't decode,
// which shows web's card with a sentence saying so (the card's tap
// shares it, as the top bar's Share does) and, for as long as the app
// runs, the timeline draws as that card too (Attachments/unplayable);
// one that doesn't answer (offline, refused, gone) says it couldn't load
// and tries again on a tap. For a screen reader the page is one adjustable element, as a
// picture's is, its value Playing or Paused: increment and decrement
// page (onStep), and activating it plays or pauses, shares, or tries
// again.
type State = "playing" | "unplayable" | "unloaded";

export default function VideoPage({
  item,
  origin,
  token,
  active,
  box,
  label,
  takeFocus,
  onPlayer,
  onShare,
  onStep,
}: {
  item: ViewerItem;
  origin: string;
  token: string;
  active: boolean;
  box: BarHeights;
  label: string;
  takeFocus: () => boolean;
  onPlayer: (up: boolean) => void;
  onShare: () => void;
  onStep: (delta: number) => void;
}) {
  const { fileId } = item.attachment;
  const [seen, setSeen] = useState(active);
  const [state, setState] = useState<State>(() => (isUnplayable(fileId) ? "unplayable" : "playing"));
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const page = useRef<ComponentRef<typeof View>>(null);
  const toggle = useRef<() => void>(() => {});
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);

  // Only the page on screen speaks for the pager.
  const up = active && state === "playing";
  useEffect(() => {
    if (active) onPlayer(up);
  }, [active, up, onPlayer]);

  useEffect(() => {
    if (!active || !takeFocus()) return;
    const timer = setTimeout(
      () => page.current && AccessibilityInfo.sendAccessibilityEvent(page.current, "focus"),
      300,
    );
    return () => clearTimeout(timer);
  }, [active, takeFocus]);

  const unplayable = useCallback(() => {
    markUnplayable(fileId);
    setState("unplayable");
  }, [fileId]);
  // An error before the file loaded may be one it can't decode, which
  // the first byte tells; one after is the network's (a drop mid-play
  // that recovers would answer the probe and be called undecodable).
  const failed = useCallback(
    (loaded: boolean) => {
      if (loaded) {
        setState("unloaded");
        return;
      }
      fileAnswers(origin, token, fileId).then((answers) => {
        if (!mounted.current) return;
        if (answers) unplayable();
        else setState("unloaded");
      });
    },
    [origin, token, fileId, unplayable],
  );
  const retry = () => {
    setState("playing");
    setAttempt((count) => count + 1);
  };

  const said =
    state === "unplayable" ? `${label}, can't play` : state === "unloaded" ? `${label}, couldn't load` : label;
  const hint =
    state === "unplayable" ? "Opens the share sheet" : state === "unloaded" ? "Tries again" : "Plays or pauses";
  return (
    <View
      ref={page}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={said}
      accessibilityHint={hint}
      accessibilityValue={state === "playing" ? { text: playing ? "Playing" : "Paused" } : undefined}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "activate" }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName !== "activate") onStep(nativeEvent.actionName === "increment" ? 1 : -1);
        else if (state === "unplayable") onShare();
        else if (state === "unloaded") retry();
        else toggle.current();
      }}
      testID="viewer-video"
      style={styles.page}
    >
      {state === "unplayable" ? (
        <CantPlay item={item} onShare={onShare} />
      ) : state === "unloaded" ? (
        <View style={styles.failed}>
          <FileIcon color={MUTED} size={28} />
          <Text style={styles.failedWords}>Couldn't load this video.</Text>
          <Pressable onPress={retry} style={styles.retry}>
            <Text style={styles.retryWords}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        seen && (
          <View style={[styles.box, { top: box.top, bottom: box.bottom }]}>
            <Player
              key={attempt}
              item={item}
              origin={origin}
              token={token}
              active={active}
              toggle={toggle}
              onFail={failed}
              onUnsupported={unplayable}
              onPlaying={setPlaying}
            />
          </View>
        )
      )}
    </View>
  );
}

function Player({
  item,
  origin,
  token,
  active,
  toggle,
  onFail,
  onUnsupported,
  onPlaying,
}: {
  item: ViewerItem;
  origin: string;
  token: string;
  active: boolean;
  toggle: RefObject<() => void>;
  onFail: (loaded: boolean) => void;
  onUnsupported: () => void;
  onPlaying: (playing: boolean) => void;
}) {
  const player = useVideoPlayer(fileSource(origin, token, item.attachment.fileId));
  const { status } = useEvent(player, "statusChange", { status: player.status });
  // Whether the source has loaded, and, where the platform says (Android),
  // whether the phone can decode any of its video tracks.
  const loaded = useRef(false);
  useEventListener(player, "playingChange", ({ isPlaying }) => onPlaying(isPlaying));
  useEventListener(player, "sourceLoad", ({ availableVideoTracks }) => {
    loaded.current = true;
    if (availableVideoTracks.length > 0 && availableVideoTracks.every((track) => track.isSupported === false)) {
      onUnsupported();
    }
  });
  useEffect(() => {
    toggle.current = () => (player.playing ? player.pause() : player.play());
  }, [player, toggle]);
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  useEffect(() => {
    if (status === "error") onFail(loaded.current);
  }, [status, onFail]);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
      style={StyleSheet.absoluteFill}
    />
  );
}

// Web's card for the file, and why it is there.
function CantPlay({ item, onShare }: { item: ViewerItem; onShare: () => void }) {
  const theme = useTheme();
  const { attachment } = item;
  return (
    <View style={styles.failed}>
      {/* The card keeps to its own width, as in the timeline. */}
      <View>
        <Card
          icon={<FileIcon color={theme[markdown.attachmentIconColor]} size={20} />}
          name={attachment.name}
          meta={formatBytes(attachment.size)}
          label={cardLabel(attachment)}
          hint="Opens the share sheet"
          onPress={onShare}
          testID="viewer-video-card"
        />
      </View>
      <Text style={styles.failedWords}>This phone can't play this video. Share it to open it elsewhere.</Text>
    </View>
  );
}

// On the viewer's black, whatever the theme.
const MUTED = "rgba(255, 255, 255, 0.7)";

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: "center",
  },
  box: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  failed: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  failedWords: {
    color: MUTED,
    fontSize: tokens.textUi,
    textAlign: "center",
  },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryWords: {
    color: "#ffffff",
    fontSize: tokens.textUi,
    fontWeight: "600",
  },
});
