import type { ReactNode } from "react";
import { type LinkPreviewActions, LinkPreviewsContext } from "./LinkPreviews/context";
import { type ChannelLinks, ChannelLinksContext } from "./MessageBody/channelLinks";

// What a screen of messages hands every row it draws: the channels a
// channel link opens (MessageBody) and what its link cards need
// (LinkPreviews).
export default function MessageContexts({
  links,
  previews,
  children,
}: {
  links: ChannelLinks | null;
  previews: LinkPreviewActions;
  children: ReactNode;
}) {
  return (
    <ChannelLinksContext.Provider value={links}>
      <LinkPreviewsContext.Provider value={previews}>{children}</LinkPreviewsContext.Provider>
    </ChannelLinksContext.Provider>
  );
}
