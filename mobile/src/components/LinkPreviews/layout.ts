import { previewShape } from "@stoop/core/linkPreviews";
import type { LinkPreview } from "@stoop/gen/stoop/chat/v1/message_pb";
// Straight from the generated values, not the theme's index, so this
// file needs no React Native and its tests run in Node.
import { markdown } from "../../theme/generated";

// How one card is laid out, by web's rules (core/linkPreviews
// previewShape, link-previews.css through theme/generated.ts), as a
// browser sizes its image: a squarish image is an 80pt thumbnail beside
// the words; a wide one goes under them, stretched to the card's width
// (no more than 520 across, less its padding and bar) and no taller than
// 260, cropped to fill; with no title the image is alone, no card round
// it, up to 400 wide, a wide one stretched to that width and capped the
// same, any other at its own size, shrunk to fit. React Native needs the
// size up front, so it is worked out here from the size the server
// measured, against the width the message's words get (`bodyWidth`,
// MessageBody/insets.ts). An image of a size the server didn't give is
// drawn as the thumbnail.
export type CardLayout = {
  imageOnly: boolean;
  landscape: boolean;
  image?: { width: number; height: number };
};

export function cardLayout(preview: LinkPreview, bodyWidth: number): CardLayout {
  const { imageOnly, landscape } = previewShape(preview);
  if (!preview.imageFileId) return { imageOnly, landscape };
  const { imageWidth: width, imageHeight: height } = preview;
  const thumb = { width: markdown.previewThumbSize, height: markdown.previewThumbSize };
  if (!(width > 0 && height > 0)) return { imageOnly, landscape: false, image: thumb };
  if (imageOnly) {
    const room = Math.min(bodyWidth, markdown.previewImageOnlyMaxWidth);
    if (landscape) return { imageOnly, landscape, image: stretched(width, height, room) };
    const scale = Math.min(1, room / width);
    return { imageOnly, landscape, image: { width: Math.floor(width * scale), height: Math.floor(height * scale) } };
  }
  if (!landscape) return { imageOnly, landscape, image: thumb };
  const room =
    Math.min(bodyWidth, markdown.previewMaxWidth) - 2 * markdown.previewPadX - markdown.previewBarWidth;
  return { imageOnly, landscape, image: stretched(width, height, room) };
}

// As wide as the room, as tall as its shape makes it up to the cap.
function stretched(width: number, height: number, room: number) {
  return { width: room, height: Math.min(markdown.previewImageMaxHeight, Math.floor((room * height) / width)) };
}
