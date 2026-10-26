import type { Attachment, Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import { createContext, useCallback, useRef, useState } from "react";
import { type ViewerItem, viewerItems } from "./items";

// Opens the viewer on a picture, for a timeline's images (Attachments)
// to call on a tap. Without it a picture opens nothing (the menu's card).
export const ViewerContext = createContext<((attachment: Attachment) => void) | null>(null);

export type Viewing = { items: ViewerItem[]; index: number };

// The viewer's state for a screen of messages: what it steps through,
// taken from the screen's shown messages as it opens and kept while it
// is open, so a message arriving or an older page loading doesn't move
// the page under the reader's finger.
export function useViewer(messages: Message[]) {
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const shown = useRef(messages);
  shown.current = messages;
  const open = useCallback((attachment: Attachment) => {
    const items = viewerItems(shown.current);
    const index = items.findIndex((item) => item.attachment.fileId === attachment.fileId);
    if (index >= 0) setViewing({ items, index });
  }, []);
  const close = useCallback(() => setViewing(null), []);
  return { viewing, open, close };
}
