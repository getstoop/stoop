import { shownPreviews } from "@stoop/core/linkPreviews";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useContext } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { markdown } from "../../theme";
import { paragraphWidth } from "../MessageBody/insets";
import Card from "./Card";
import { LinkPreviewsContext } from "./context";
import { cardLayout } from "./layout";

// The cards for a message's links, under its words and files, as web's
// LinkPreviews draws them in a row: the previews the server fetched
// (message.link_previews, at most three, in the message's order), less
// a link to a message on this server (core/linkPreviews shownPreviews).
// The author, or whoever moderates the space, gets a × on each that
// takes it off for everyone (LinkPreviewsContext). Drawn by the row, not
// MessageBody, as on web, so the menu's card shows none.
export default function LinkPreviews({
  message,
  myUserId,
  origin,
  token,
  onLongPress,
}: {
  message: Message;
  myUserId: string;
  origin: string;
  token: string;
  onLongPress?: () => void;
}) {
  const actions = useContext(LinkPreviewsContext);
  const window = useWindowDimensions();
  const shown = shownPreviews(message.linkPreviews, actions?.origins ?? []);
  if (shown.length === 0) return null;
  const dismiss = actions && (message.author?.id === myUserId || actions.canModerate) ? actions.dismiss : undefined;
  const bodyWidth = paragraphWidth(window.width, "row", 0);
  return (
    <View style={styles.column}>
      {shown.map((preview) => (
        <Card
          key={preview.url}
          preview={preview}
          layout={cardLayout(preview, bodyWidth)}
          origin={origin}
          token={token}
          onLongPress={onLongPress}
          onDismiss={dismiss && (() => dismiss(message, preview.url))}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: markdown.previewsGap,
    marginTop: markdown.previewsMarginTop,
  },
});
