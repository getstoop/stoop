import { previewSite } from "@stoop/core/linkPreviews";
import type { LinkPreview } from "@stoop/gen/stoop/chat/v1/message_pb";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { markdown, type Theme, tokens, useTheme } from "../../theme";
import { CloseIcon } from "../Icons";
import type { CardLayout } from "./layout";

// One link's card, as web's LinkPreviewCard draws it: the site's name,
// the title in the accent and up to three lines of description, on the
// message's surface behind the accent bar, with the image beside or
// under them, or the image alone. The image is the server's copy, from
// /files with the session (as an avatar is), so nothing reaches the
// linked site; one that won't load is left out. A tap opens the link in
// the browser; a long press is the row's. `onDismiss`, for whoever may
// delete the message, puts web's × over the card's corner.
export default function Card({
  preview,
  layout,
  origin,
  token,
  onLongPress,
  onDismiss,
}: {
  preview: LinkPreview;
  layout: CardLayout;
  origin: string;
  token: string;
  onLongPress?: () => void;
  onDismiss?: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [failed, setFailed] = useState(false);
  const { imageOnly, landscape, image } = layout;
  const site = previewSite(preview);
  const words = [site, preview.title, preview.description].filter((part) => part !== "").join(", ");
  // An image alone that won't load leaves nothing to draw, not even the ×.
  if (imageOnly && failed) return null;

  return (
    <View style={[styles.frame, imageOnly && styles.imageOnlyFrame]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={imageOnly ? site || preview.url : words}
        accessibilityHint="Opens in the browser"
        testID="link-preview"
        onPress={() => Linking.openURL(preview.url).catch(() => {})}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          imageOnly ? undefined : styles.card,
          !imageOnly && landscape && styles.column,
          pressed && styles.down,
        ]}
      >
        {!imageOnly && (
          <View style={styles.words}>
            <Text style={styles.site}>{site}</Text>
            <Text style={styles.title}>{preview.title}</Text>
            {preview.description !== "" && (
              <Text style={styles.description} numberOfLines={markdown.previewDescriptionLines}>
                {preview.description}
              </Text>
            )}
          </View>
        )}
        {image && !failed && (
          <Image
            source={{ uri: `${origin}/files/${preview.imageFileId}`, headers: { Authorization: `Bearer ${token}` } }}
            style={[styles.image, image]}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        )}
      </Pressable>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove preview"
          onPress={onDismiss}
          onLongPress={onLongPress}
          hitSlop={8}
          style={({ pressed }) => [styles.dismiss, pressed && styles.down]}
        >
          <CloseIcon color={theme.textMuted} size={DISMISS_ICON} />
        </Pressable>
      )}
    </View>
  );
}

// Web's .icon-button: its 18 icon in 4 of padding.
const DISMISS_ICON = 18;
const DISMISS_PAD = 4;

function makeStyles(theme: Theme) {
  const leading = (size: number) => size * tokens.leadingBody;
  return StyleSheet.create({
    frame: {
      maxWidth: markdown.previewMaxWidth,
    },
    imageOnlyFrame: {
      maxWidth: markdown.previewImageOnlyMaxWidth,
      alignSelf: "flex-start",
    },
    card: {
      flexDirection: "row",
      gap: markdown.previewGap,
      paddingVertical: markdown.previewPadY,
      paddingHorizontal: markdown.previewPadX,
      borderLeftWidth: markdown.previewBarWidth,
      borderLeftColor: theme[markdown.previewBarColor],
      borderRadius: tokens.radius,
      backgroundColor: theme[markdown.previewBg],
    },
    column: {
      flexDirection: "column",
    },
    // As a reaction chip takes a press.
    down: {
      opacity: 0.85,
    },
    words: {
      flex: 1,
      minWidth: 0,
      gap: markdown.previewTextGap,
    },
    site: {
      color: theme[markdown.previewSiteColor],
      fontSize: tokens.textSm,
      lineHeight: leading(tokens.textSm),
    },
    title: {
      color: theme[markdown.previewTitleColor],
      fontSize: tokens.textBody,
      lineHeight: leading(tokens.textBody),
      fontWeight: markdown.previewTitleWeight,
    },
    description: {
      color: theme[markdown.previewDescriptionColor],
      fontSize: tokens.textUi,
      lineHeight: leading(tokens.textUi),
    },
    image: {
      borderRadius: tokens.radiusSm,
      backgroundColor: theme.raised,
    },
    dismiss: {
      position: "absolute",
      top: markdown.previewDismissInset,
      right: markdown.previewDismissInset,
      padding: DISMISS_PAD,
      borderRadius: tokens.radius,
      backgroundColor: theme[markdown.previewDismissBg],
    },
  });
}
