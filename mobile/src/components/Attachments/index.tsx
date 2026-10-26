import { attachmentKind } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useContext } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { markdown, useTheme } from "../../theme";
import { FileIcon } from "../Icons";
import { paragraphWidth } from "../MessageBody/insets";
import { AudioContext } from "./audio";
import AudioPlayer from "./AudioPlayer";
import Card from "./Card";
import FileCard from "./FileCard";
import { attachmentsLayout } from "./layout";
import Picture from "./Picture";
import Strip from "./Strip";
import { useUnplayable } from "./unplayable";
import VideoTile from "./VideoTile";
import { expiredLabel, expiredText, imageLabel, tileLabel, videoLabel } from "./words";

// A message's files, under its words, as web's Attachments draws them
// where a phone can (layout.ts says where it can't): an image inline, a
// video as a tile with its first frame that plays full screen, two or
// more of them in a grid, audio as a player (the screen's, AudioContext; without one, the
// card), any other file as a card that a tap shares, an expired one as
// its placeholder, which nothing fetches. The same in a
// channel's rows and a thread's; on the message menu's card (`compact`)
// a strip of thumbnails and chips. A long press anywhere is the row's.
export default function Attachments({
  attachments,
  origin,
  token,
  compact = false,
  onLongPress,
}: {
  attachments: Attachment[];
  origin: string;
  token: string;
  compact?: boolean;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const unplayable = useUnplayable();
  const playback = useContext(AudioContext);
  if (attachments.length === 0) return null;
  if (compact) return <Strip attachments={attachments} origin={origin} token={token} />;
  const parts = attachmentsLayout(attachments, paragraphWidth(window.width, "row", 0), unplayable);
  const shared = { origin, token, onLongPress };
  return (
    <View style={styles.column}>
      {parts.map((part) => {
        switch (part.kind) {
          case "image":
            return (
              <Picture
                key={part.attachment.fileId}
                attachment={part.attachment}
                box={part.box}
                fit={part.fit}
                label={imageLabel(part.attachment)}
                {...shared}
              />
            );
          case "video":
            return (
              <VideoTile
                key={part.attachment.fileId}
                attachment={part.attachment}
                box={part.box}
                label={videoLabel(part.attachment)}
                {...shared}
              />
            );
          case "grid":
            return (
              <View key="grid" style={[styles.grid, { width: 2 * part.tile + markdown.attachmentsGap }]}>
                {part.attachments.map((attachment, index) => {
                  const box = { width: part.tile, height: part.tile };
                  const count = part.attachments.length;
                  return attachmentKind(attachment) === "video" ? (
                    <VideoTile
                      key={attachment.fileId}
                      attachment={attachment}
                      box={box}
                      label={tileLabel(attachment, index, count, true)}
                      tile
                      {...shared}
                    />
                  ) : (
                    <Picture
                      key={attachment.fileId}
                      attachment={attachment}
                      box={box}
                      fit="cover"
                      label={tileLabel(attachment, index, count)}
                      tile
                      {...shared}
                    />
                  );
                })}
              </View>
            );
          case "audio":
            return playback ? (
              <AudioPlayer
                key={part.attachment.fileId}
                attachment={part.attachment}
                width={part.width}
                playback={playback}
                {...shared}
              />
            ) : (
              <FileCard key={part.attachment.fileId} attachment={part.attachment} {...shared} />
            );
          case "card":
            return <FileCard key={part.attachment.fileId} attachment={part.attachment} {...shared} />;
          case "expired":
            return (
              <Card
                key={part.attachment.fileId}
                icon={<FileIcon color={theme.textMuted} size={20} />}
                meta={expiredText(part.attachment)}
                label={expiredLabel(part.attachment)}
                dashed
              />
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: markdown.attachmentsGap,
    marginTop: markdown.attachmentsMarginTop,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: markdown.attachmentsGap,
  },
});
