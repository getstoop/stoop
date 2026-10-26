import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import type { ReactNode } from "react";
import { type LinkPreviewActions, LinkPreviewsContext } from "./LinkPreviews/context";
import { type ChannelLinks, ChannelLinksContext } from "./MessageBody/channelLinks";
import { ViewerContext } from "./Viewer/useViewer";

// What a screen of messages hands every row it draws: the channels a
// channel link opens (MessageBody), what its link cards need
// (LinkPreviews) and, in a timeline, how a picture opens the viewer
// (Attachments, useViewer).
export default function MessageContexts({
  links,
  previews,
  view = null,
  children,
}: {
  links: ChannelLinks | null;
  previews: LinkPreviewActions;
  view?: ((attachment: Attachment) => void) | null;
  children: ReactNode;
}) {
  return (
    <ChannelLinksContext.Provider value={links}>
      <LinkPreviewsContext.Provider value={previews}>
        <ViewerContext.Provider value={view}>{children}</ViewerContext.Provider>
      </LinkPreviewsContext.Provider>
    </ChannelLinksContext.Provider>
  );
}
