import { formatBytes } from "@stoop/core/attachments";
import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import { markdown, useTheme } from "../../theme";
import { FileIcon } from "../Icons";
import Card from "./Card";
import { useShareFile } from "./useShareFile";
import { cardLabel, downloadedText } from "./words";

// A file drawn as web's card. A tap downloads it into the app's cache,
// counting what has arrived in the size's slot over a line along the
// card's foot, then opens the system share sheet on it (useShareFile).
// A second tap while it downloads does nothing; a failure says so in
// the size's slot until the next tap.
export default function FileCard({
  attachment,
  origin,
  token,
  onLongPress,
}: {
  attachment: Attachment;
  origin: string;
  token: string;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const { sharing: download, share } = useShareFile(origin, token, true);

  const size = Number(attachment.size);
  const meta =
    download.state === "going"
      ? downloadedText(download.written, size)
      : download.state === "failed"
        ? "Couldn't download"
        : formatBytes(size);
  return (
    <Card
      icon={<FileIcon color={theme[markdown.attachmentIconColor]} size={20} />}
      name={attachment.name}
      meta={meta}
      label={download.state === "idle" ? cardLabel(attachment) : `${attachment.name}, ${meta}`}
      hint="Opens the share sheet"
      progress={download.state === "going" && size > 0 ? Math.min(1, download.written / size) : undefined}
      onPress={() => share(attachment)}
      onLongPress={onLongPress}
      testID="attachment-card"
    />
  );
}
