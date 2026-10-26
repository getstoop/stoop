// Which of a message's link previews show as cards, and how each is laid
// out: shared by web's LinkPreviews and the phone's.
import type { LinkPreview } from "../gen/stoop/chat/v1/message_pb";
import { linkedMessage } from "./shareLinks";

// An image at least this much wider than tall goes under the words, at
// the card's width; anything squarer is a thumbnail beside them.
export const LANDSCAPE_RATIO = 1.3;

// The previews drawn as cards, in the message's order: all but a link to
// a message on this server, which is read as that message instead
// (LinkedMessages on web).
export function shownPreviews(
  previews: LinkPreview[],
  origins: string[],
): LinkPreview[] {
  return previews.filter((preview) => !linkedMessage(preview.url, origins));
}

export type PreviewShape = {
  // An image and no title: the image alone, with no card around it.
  imageOnly: boolean;
  // The image goes under the words rather than beside them.
  landscape: boolean;
};

export function previewShape(preview: LinkPreview): PreviewShape {
  return {
    imageOnly: !preview.title && !!preview.imageFileId,
    landscape: preview.imageWidth >= preview.imageHeight * LANDSCAPE_RATIO,
  };
}

// The card's first line: the site's own name, or the link's host
// without "www.".
export function previewSite(preview: LinkPreview): string {
  if (preview.siteName) return preview.siteName;
  try {
    return new URL(preview.url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
