import { formatBytes } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useState } from "react";
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { markdown, type Theme, tokens, useTheme } from "../../theme";
import { PauseIcon, PlayIcon } from "../Icons";
import { type AudioPlayback, useAudioFile } from "./audio";
import { audioLabel, audioTime, clock } from "./words";

// An audio file in the timeline, as web's: the name and size in a row of
// their own over a player, drawn here rather than the platform's: a
// round Play or Pause in the accent, the track, and the time. Nothing
// plays until Play is tapped, and the screen's playback plays one file
// at a time (audio.ts). Once it has started, a tap or a drag along the
// track moves it there, and a screen reader adjusts the track by a
// tenth. A long press anywhere is the row's.
export default function AudioPlayer({
  attachment,
  width,
  origin,
  token,
  playback,
  onLongPress,
}: {
  attachment: Attachment;
  width: number;
  origin: string;
  token: string;
  playback: AudioPlayback;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const { state, duration } = useAudioFile(playback, attachment.fileId);
  const [trackWidth, setTrackWidth] = useState(0);
  const playing = !!state?.playing;
  const position = state?.position ?? 0;
  const seekable = !!state && duration > 0;
  const progress = seekable ? Math.min(1, position / duration) : 0;

  const seekTo = (event: GestureResponderEvent) => {
    if (trackWidth > 0) playback.seek(attachment.fileId, (event.nativeEvent.locationX / trackWidth) * duration);
  };
  const Icon = playing ? PauseIcon : PlayIcon;
  return (
    <Pressable onLongPress={onLongPress} accessible={false} style={[styles.frame, { width }]}>
      <View style={styles.caption}>
        <Text style={styles.name} numberOfLines={1}>
          {attachment.name}
        </Text>
        <Text style={styles.size}>{formatBytes(attachment.size)}</Text>
      </View>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={audioLabel(attachment, playing)}
          onPress={() => playback.toggle(origin, token, attachment)}
          onLongPress={onLongPress}
          testID="attachment-audio-play"
          style={styles.button}
        >
          <View style={styles.round}>
            <Icon color={theme.onAccent} size={ICON} />
          </View>
        </Pressable>
        <View
          accessible={seekable}
          accessibilityRole="adjustable"
          accessibilityLabel={`Position in ${attachment.name}`}
          accessibilityValue={seekable ? { text: `${clock(position)} of ${clock(Math.round(duration))}` } : undefined}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            const step = (nativeEvent.actionName === "increment" ? 1 : -1) * (duration / 10);
            playback.seek(attachment.fileId, position + step);
          }}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => seekable}
          onResponderGrant={seekTo}
          onResponderMove={seekTo}
          style={styles.track}
        >
          <View style={styles.rail} pointerEvents="none">
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
        </View>
        <Text style={styles.time} testID="attachment-audio-time">
          {audioTime(!!state, position, duration)}
        </Text>
      </View>
    </Pressable>
  );
}

// The design's 32 round in a 48 square for the finger, its icon 14.
const BUTTON = 48;
const ROUND = 32;
const ICON = 14;
const RAIL = 4;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // Web's .attachment-audio: the image's frame on the panel.
    frame: {
      maxWidth: "100%",
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      overflow: "hidden",
    },
    // Web's .attachment-bar-static, over the player.
    caption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: markdown.attachmentBarPadY,
      paddingLeft: markdown.attachmentBarPadStart,
      paddingRight: markdown.attachmentBarPadX,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    name: {
      flex: 1,
      color: theme.text,
      fontSize: tokens.textSm,
      fontWeight: "600",
    },
    size: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
    controls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: BUTTON,
      paddingRight: 12,
    },
    button: {
      width: BUTTON,
      height: BUTTON,
      alignItems: "center",
      justifyContent: "center",
    },
    round: {
      width: ROUND,
      height: ROUND,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    // The whole height for the finger; the rail drawn in its middle.
    track: {
      flex: 1,
      height: BUTTON,
      justifyContent: "center",
    },
    rail: {
      height: RAIL,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.raised,
      overflow: "hidden",
    },
    fill: {
      height: RAIL,
      backgroundColor: theme.accent,
    },
    time: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
      fontVariant: ["tabular-nums"],
    },
  });
}
