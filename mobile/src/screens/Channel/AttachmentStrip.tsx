import { formatBytes } from "@stoop/core/attachments";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { CloseIcon, FileIcon, PlayIcon } from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import type { PendingFile } from "./useAttachments";

// The files the composer holds, along the top of its card, as the
// attaching mockup draws them: a photo or a video as a 64pt thumbnail (a
// video as a play mark with its length, there being no frame to show
// without decoding it), any other file as a chip with its name and size,
// and each with a remove × at its corner. A spinner covers a thumbnail
// while it uploads, and a chip says so in its size's place. One that
// failed is drawn as a chip in the danger colours with the reason there,
// until it is removed. Scrolls sideways when the files outrun the card,
// taps landing without putting the keyboard away.

export default function AttachmentStrip({
  files,
  raised,
  onRemove,
}: {
  files: PendingFile[];
  // The chip's fill: solid, or translucent on glass.
  raised: ViewStyle;
  onRemove: (key: string) => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.strip}
      accessibilityRole="list"
      accessibilityLabel="Attached files"
      testID="attachment-strip"
    >
      {files.map((file) => {
        const uploading = !file.fileId && !file.error;
        const media = (file.kind === "image" || file.kind === "video") && !file.error;
        const label = file.error
          ? `${file.name}, ${file.error}`
          : uploading
            ? `${file.name}, uploading`
            : file.name;
        return (
          <View key={file.key} style={media ? styles.thumb : [styles.chip, raised, file.error ? styles.failed : null]}>
            {media ? (
              <View accessible accessibilityLabel={label} style={styles.media}>
                {file.kind === "image" ? (
                  <Image source={{ uri: file.uri }} style={styles.image} resizeMode="cover" />
                ) : (
                  <>
                    <PlayIcon color={theme.textMuted} />
                    {file.duration !== undefined && <Text style={styles.length}>{duration(file.duration)}</Text>}
                  </>
                )}
              </View>
            ) : (
              <View accessible accessibilityLabel={label} style={styles.chipBody}>
                {file.kind === "image" && file.error ? (
                  <Image source={{ uri: file.uri }} style={styles.small} resizeMode="cover" />
                ) : (
                  <FileIcon color={theme.textMuted} />
                )}
                <View style={styles.words}>
                  <Text numberOfLines={1} style={styles.name}>
                    {file.name}
                  </Text>
                  <Text numberOfLines={1} style={file.error ? styles.reason : styles.meta}>
                    {file.error ?? (uploading ? "Uploading…" : file.size !== undefined ? formatBytes(file.size) : "")}
                  </Text>
                </View>
              </View>
            )}
            {uploading && media && (
              <View style={styles.busy} pointerEvents="none">
                <ActivityIndicator color="#ffffff" />
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${file.name}`}
              onPress={() => onRemove(file.key)}
              // Drawn at 24; a 40 touch target.
              hitSlop={8}
              style={({ pressed }) => [styles.remove, pressed && styles.down]}
            >
              <CloseIcon color={theme.surface} size={12} />
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

// A video's length as m:ss.
function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // Room above and at the end for the last remove × to sit over the
    // corner unclipped.
    strip: {
      gap: 8,
      paddingTop: 6,
      paddingBottom: 2,
      paddingLeft: 2,
      paddingRight: 6,
    },
    thumb: {
      width: 64,
      height: 64,
    },
    media: {
      flex: 1,
      borderRadius: tokens.radiusLg,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    image: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    length: {
      position: "absolute",
      left: 6,
      bottom: 4,
      color: theme.text,
      fontSize: 11,
      fontWeight: "600",
    },
    chip: {
      width: 168,
      height: 64,
      borderRadius: tokens.radiusLg,
    },
    chipBody: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 10,
      paddingRight: 28,
    },
    failed: {
      backgroundColor: theme.dangerSoft,
      borderWidth: 1.5,
      borderColor: theme.danger,
    },
    small: {
      width: 32,
      height: 32,
      borderRadius: tokens.radiusSm,
    },
    words: {
      flex: 1,
      gap: 2,
    },
    name: {
      color: theme.text,
      fontSize: 13,
      fontWeight: "600",
    },
    meta: {
      color: theme.textMuted,
      fontSize: 12,
    },
    reason: {
      color: theme.danger,
      fontSize: 12,
    },
    busy: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: tokens.radiusLg,
      backgroundColor: "rgba(0, 0, 0, 0.45)",
      alignItems: "center",
      justifyContent: "center",
    },
    remove: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 24,
      height: 24,
      borderRadius: tokens.radiusPill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.text,
    },
    down: {
      opacity: 0.85,
    },
  });
}
