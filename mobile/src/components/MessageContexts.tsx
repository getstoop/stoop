import type { Attachment } from "@stoop/gen/stoop/chat/v1/message_pb";
import type { ReactNode } from "react";
import { type LinkPreviewActions, LinkPreviewsContext } from "./LinkPreviews/context";
import { type ChannelLinks, ChannelLinksContext } from "./MessageBody/channelLinks";
import { AudioContext, type AudioPlayback } from "./Attachments/audio";
import { ViewerContext } from "./Viewer/useViewer";

// What a screen of messages hands every row it draws: the channels a
// channel link opens (MessageBody), what its link cards need
// (LinkPreviews) and, in a timeline, how a picture opens the viewer
// (Attachments, useViewer) and what plays its audio (useAudioPlayback).
export default function MessageContexts({
  links,
  previews,
  view = null,
  audio = null,
  children,
}: {
  links: ChannelLinks | null;
  previews: LinkPreviewActions;
  view?: ((attachment: Attachment) => void) | null;
  audio?: AudioPlayback | null;
  children: ReactNode;
}) {
  return (
    <ChannelLinksContext.Provider value={links}>
      <LinkPreviewsContext.Provider value={previews}>
        <ViewerContext.Provider value={view}>
          <AudioContext.Provider value={audio}>{children}</AudioContext.Provider>
        </ViewerContext.Provider>
      </LinkPreviewsContext.Provider>
    </ChannelLinksContext.Provider>
  );
}
