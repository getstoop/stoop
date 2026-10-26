import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Image } from "expo-image";
import { useContext, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { fileSource } from "../../api/downloads";
import { type Theme, tokens, useTheme } from "../../theme";
import { PhotoIcon } from "../Icons";
import { ViewerContext } from "../Viewer/useViewer";
import Card from "./Card";
import type { Box, Fit } from "./layout";

// An image in its box, the size layout.ts gave it, so the row never
// moves when it lands: the box on the panel with a faint image glyph
// while it loads (no spinner, as web shows none), then the picture (its
// thumbnail when the server made one), fetched from /files with the
// session and decoded at the size it is drawn (expo-image, which keeps
// it in its memory and disk caches). One that won't load turns into a
// card in its place that says so and tries again on a tap, or, as a
// grid's tile, says so inside the tile; a remount tries again too. In a
// timeline a tap opens the viewer on it (ViewerContext), which a lone
// image's label says and a tile's hint. A long press is the row's.
export default function Picture({
  attachment,
  box,
  fit,
  label,
  origin,
  token,
  tile = false,
  onLongPress,
}: {
  attachment: Attachment;
  box: Box;
  fit: Fit;
  label: string;
  origin: string;
  token: string;
  tile?: boolean;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const view = useContext(ViewerContext);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const retry = () => {
    setState("loading");
    setAttempt((n) => n + 1);
  };

  if (state === "failed" && !tile) {
    return (
      <Card
        icon={<PhotoIcon color={theme.textMuted} size={20} />}
        name={attachment.name}
        meta="Couldn't load · tap to retry"
        label={`${label}, couldn't load`}
        hint="Tries again"
        onPress={retry}
        onLongPress={onLongPress}
        testID="attachment-failed"
      />
    );
  }
  if (state === "failed") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, couldn't load`}
        accessibilityHint="Tries again"
        onPress={retry}
        onLongPress={onLongPress}
        style={[styles.frame, styles.failedTile, box]}
      >
        <PhotoIcon color={theme.textMuted} size={20} />
        <Text style={styles.failedWords}>Couldn't load</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole={view ? "imagebutton" : "image"}
      accessibilityLabel={view && !tile ? `${label}. Opens full screen` : label}
      accessibilityHint={view && tile ? "Opens full screen" : undefined}
      onPress={view ? () => view(attachment) : undefined}
      onLongPress={onLongPress}
      disabled={!view && !onLongPress}
      testID="attachment-image"
      style={[styles.frame, box]}
    >
      {state === "loading" && <PhotoIcon color={theme.border} size={GLYPH} />}
      <Image
        key={attempt}
        source={fileSource(origin, token, attachment.thumbnailFileId || attachment.fileId)}
        recyclingKey={attachment.fileId}
        contentFit={fit}
        style={StyleSheet.absoluteFill}
        onLoad={() => setState("shown")}
        onError={() => setState("failed")}
      />
    </Pressable>
  );
}

const GLYPH = 28;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // Web's .attachment-image: the panel, a 1px border, the 8 radius.
    frame: {
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radiusMd,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.panel,
      overflow: "hidden",
    },
    failedTile: {
      gap: 4,
    },
    failedWords: {
      color: theme.textMuted,
      fontSize: tokens.textSm,
    },
  });
}
