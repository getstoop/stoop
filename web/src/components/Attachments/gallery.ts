import { createContext } from "react";
import { isInlineImage } from "../../api/files";
import type { Attachment, Message } from "../../gen/stoop/chat/v1/message_pb";

// The images a preview steps through: those of the message list it was
// opened from, oldest first. Null outside a list, where it shows one.
export const GalleryImages = createContext<Attachment[] | null>(null);

export function galleryImages(messages: Message[]): Attachment[] {
  return messages.flatMap((m) =>
    m.attachments.filter((a) => !a.expired && isInlineImage(a.contentType)),
  );
}
