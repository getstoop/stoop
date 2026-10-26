import { formatBytes } from "@stoop/core/attachments";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { type ComponentRef, type RefObject, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { fileSource } from "../../api/downloads";
import { markdown, tokens, useTheme } from "../../theme";
import Card from "../Attachments/Card";
import { markUnplayable } from "../Attachments/unplayable";
import { cardLabel } from "../Attachments/words";
import { FileIcon } from "../Icons";
import type { ViewerItem } from "./items";

// A video in the viewer (expo-video: AVPlayer, ExoPlayer), fitted to the
// screen with the platform's own controls. It plays, with sound, when
// its page is the one on screen (`active`), since the tap that opened it
// asked for that, and pauses when paged away from; the pager unmounts a
// page beyond its neighbours, and closing the viewer, either of which
// releases it. A page is given a player only once it has been on screen,
// so a neighbour fetches nothing. The file comes from /files with the
// session, by Range requests. One this phone can't play shows web's card
// with a sentence saying so, and the card's tap shares it (onShare, as
// the top bar's Share); the timeline then draws it as that card too
// (Attachments/unplayable). Every touch on the video is its controls':
// a gesture over it keeps them from showing, so the pager's swipe is off
// on a video's page (index.tsx) and a sideways swipe from either edge
// pages instead (EdgeSwipe); there is no drag down to close, and the
// viewer's bars stay up over it. For a screen reader the
// page is one adjustable element, as a picture's is: increment and
// decrement page (onStep), and activating it plays or pauses (or, when
// it can't play, shares).
export default function VideoPage({
  item,
  origin,
  token,
  active,
  label,
  takeFocus,
  onShare,
  onStep,
}: {
  item: ViewerItem;
  origin: string;
  token: string;
  active: boolean;
  label: string;
  takeFocus: () => boolean;
  onShare: () => void;
  onStep: (delta: number) => void;
}) {
  const [seen, setSeen] = useState(active);
  const [failed, setFailed] = useState(false);
  const page = useRef<ComponentRef<typeof View>>(null);
  const toggle = useRef<() => void>(() => {});
  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);

  useEffect(() => {
    if (!active || !takeFocus()) return;
    const timer = setTimeout(
      () => page.current && AccessibilityInfo.sendAccessibilityEvent(page.current, "focus"),
      300,
    );
    return () => clearTimeout(timer);
  }, [active, takeFocus]);

  return (
    <View
      ref={page}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={failed ? `${label}, can't play` : label}
      accessibilityHint={failed ? "Opens the share sheet" : "Plays or pauses"}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "activate" }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "activate") {
          if (failed) onShare();
          else toggle.current();
        } else onStep(nativeEvent.actionName === "increment" ? 1 : -1);
      }}
      testID="viewer-video"
      style={styles.page}
    >
      {failed ? (
        <CantPlay item={item} onShare={onShare} />
      ) : (
        seen && (
          <Player
            item={item}
            origin={origin}
            token={token}
            active={active}
            toggle={toggle}
            onFail={() => {
              markUnplayable(item.attachment.fileId);
              setFailed(true);
            }}
          />
        )
      )}
      <EdgeSwipe side="left" onStep={onStep} />
      <EdgeSwipe side="right" onStep={onStep} />
    </View>
  );
}

// A strip down one edge, beside the player rather than over it, where a
// sideways swipe or fling pages as the pager's would.
function EdgeSwipe({ side, onStep }: { side: "left" | "right"; onStep: (delta: number) => void }) {
  const pan = usePanGesture({
    maxPointers: 1,
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onDeactivate: (event) => {
      if (event.translationX < -EDGE_DISTANCE || event.velocityX < -EDGE_FLING) scheduleOnRN(onStep, 1);
      else if (event.translationX > EDGE_DISTANCE || event.velocityX > EDGE_FLING) scheduleOnRN(onStep, -1);
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.edge, side === "left" ? styles.left : styles.right]} />
    </GestureDetector>
  );
}

// The edge strip's width, and how far or fast a swipe on it must go.
const EDGE = 32;
const EDGE_DISTANCE = 40;
const EDGE_FLING = 500;

function Player({
  item,
  origin,
  token,
  active,
  toggle,
  onFail,
}: {
  item: ViewerItem;
  origin: string;
  token: string;
  active: boolean;
  toggle: RefObject<() => void>;
  onFail: () => void;
}) {
  const player = useVideoPlayer(fileSource(origin, token, item.attachment.fileId));
  const { status } = useEvent(player, "statusChange", { status: player.status });
  useEffect(() => {
    toggle.current = () => (player.playing ? player.pause() : player.play());
  }, [player, toggle]);
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  useEffect(() => {
    if (status === "error") onFail();
  }, [status, onFail]);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: false }}
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
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: EDGE,
  },
  left: {
    left: 0,
  },
  right: {
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
});
