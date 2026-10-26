import { formatBytes } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { markdown, type Theme, tokens, useTheme } from "../../theme";
import { PlayIcon } from "../Icons";
import { ViewerContext } from "../Viewer/useViewer";
import type { Box } from "./layout";

// A video in the timeline: web's frame on black with its round play
// badge, and, alone, web's bar with the name and size over its foot,
// always shown. Drawn, not a player: nothing plays here and nothing is
// fetched, since the server has no still to show (the proposal's
// decision 10). A tap opens the viewer, which plays it (ViewerContext);
// a long press is the row's.
export default function VideoTile({
  attachment,
  box,
  label,
  tile = false,
  onLongPress,
}: {
  attachment: Attachment;
  box: Box;
  label: string;
  tile?: boolean;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const view = useContext(ViewerContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={tile ? "Plays full screen" : undefined}
      onPress={view ? () => view(attachment) : undefined}
      onLongPress={onLongPress}
      disabled={!view && !onLongPress}
      testID="attachment-video"
      style={[styles.frame, box]}
    >
      <View style={styles.badge}>
        <PlayIcon color={theme.text} size={BADGE_ICON} />
      </View>
      {!tile && (
        <View style={styles.bar}>
          <Text style={styles.name} numberOfLines={1}>
            {attachment.name}
          </Text>
          <Text style={styles.size}>{formatBytes(attachment.size)}</Text>
        </View>
      )}
    </Pressable>
  );
}

// Web's .attachment-video-play: a 20 icon in 8 of padding.
const BADGE_ICON = 20;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // Web's .attachment-video: the 1px border and the 8 radius, on black
    // in every theme, as web's letterbox is.
    frame: {
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: "#000000",
      overflow: "hidden",
    },
    badge: {
      padding: 8,
      borderRadius: tokens.radiusPill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.raised,
    },
    // Web's .attachment-bar, over the foot. Its background is the canvas
    // at 85% (a color-mix in attachments.css, which the generator can't
    // carry): the hex's alpha byte.
    bar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: markdown.attachmentBarPadY,
      paddingLeft: markdown.attachmentBarPadStart,
      paddingRight: markdown.attachmentBarPadX,
      backgroundColor: `${theme.canvas}d9`,
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
  });
}
