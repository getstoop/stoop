import { attachmentKind, formatBytes } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { fileSource } from "../../api/downloads";
import { markdown, type Theme, tokens, useTheme } from "../../theme";
import { FileIcon, PlayIcon } from "../Icons";
import { cardLabel, expiredLabel, imageLabel } from "./words";

// A message's files on the message menu's card, small, in the look of
// the composer's strip (screens/Channel/AttachmentStrip): an image as a
// 64pt thumbnail (the server's when there is one), a video as a play
// mark, anything else as a chip with its name and size, an expired file
// as a dashed chip. A full-size photo
// would push the menu off the screen. The card takes no touches, so
// they wrap rather than scroll.
export default function Strip({
  attachments,
  origin,
  token,
}: {
  attachments: Attachment[];
  origin: string;
  token: string;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.strip} testID="attachment-strip-compact">
      {attachments.map((attachment) => {
        const kind = attachmentKind(attachment);
        if (kind === "image" || kind === "video") {
          return (
            <View
              key={attachment.fileId}
              accessible
              accessibilityLabel={kind === "image" ? imageLabel(attachment) : `Video, ${attachment.name}`}
              style={styles.thumb}
            >
              {kind === "image" ? (
                <Image
                  source={fileSource(origin, token, attachment.thumbnailFileId || attachment.fileId)}
                  recyclingKey={attachment.fileId}
                  contentFit="cover"
                  style={StyleSheet.absoluteFill}
                />
              ) : (
                <PlayIcon color={theme.textMuted} />
              )}
            </View>
          );
        }
        const expired = kind === "expired";
        return (
          <View
            key={attachment.fileId}
            accessible
            accessibilityLabel={expired ? expiredLabel(attachment) : cardLabel(attachment)}
            style={[styles.chip, expired && styles.dashed]}
          >
            <FileIcon color={expired ? theme.textMuted : theme[markdown.attachmentIconColor]} />
            <View style={styles.words}>
              <Text numberOfLines={1} style={expired ? styles.meta : styles.name}>
                {expired ? "Expired attachment" : attachment.name}
              </Text>
              <Text numberOfLines={1} style={styles.meta}>
                {formatBytes(attachment.size)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// The composer strip's sizes.
const THUMB = 64;
const CHIP_WIDTH = 168;

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    strip: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: markdown.attachmentsMarginTop,
    },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: tokens.radiusLg,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    chip: {
      width: CHIP_WIDTH,
      height: THUMB,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 10,
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.raised,
    },
    dashed: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.border,
      backgroundColor: "transparent",
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
  });
}
