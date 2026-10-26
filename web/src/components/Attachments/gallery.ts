import { createContext, useContext, useState } from "react";
import type { Attachment } from "../../gen/stoop/chat/v1/message_pb";

export { galleryMedia } from "../../core/attachments";

// What a preview steps through: the images and videos of the message
// list it was opened from, oldest first. Null outside a list, where it
// shows one.
export const GalleryMedia = createContext<Attachment[] | null>(null);

// One attachment's preview: open() shows it, and the steps move to its
// neighbours in the list. shown is undefined while it is closed.
export function usePreview(a: Attachment) {
  const [shownId, setShownId] = useState<string | null>(null);
  const media = useContext(GalleryMedia) ?? [a];
  const index = media.findIndex((item) => item.fileId === shownId);
  const previous = media[index - 1];
  const next = media[index + 1];
  return {
    shown: media[index] as Attachment | undefined,
    open: () => setShownId(a.fileId),
    close: () => setShownId(null),
    onPrevious: previous && (() => setShownId(previous.fileId)),
    onNext: next && (() => setShownId(next.fileId)),
  };
}
