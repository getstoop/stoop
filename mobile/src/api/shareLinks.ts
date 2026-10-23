import { messagePath, threadPath } from "@stoop/core/shareLinks";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";

// The link to a message, as web's channel builds it for Copy link
// (routes/Channel/MessageList): the server's origin as the app saved it
// (the string its requests go to, no trailing slash) and the channel
// opened around the message; a reply in a thread opens the thread on
// it. A direct message has no space and gets the /dm/ path.
export function messageLink(origin: string, spaceId: string, message: Message): string {
  const { channelId, threadRootId, id } = message;
  const path =
    threadRootId && threadRootId !== id
      ? threadPath(spaceId, channelId, threadRootId, id)
      : messagePath(spaceId, channelId, id);
  return origin.replace(/\/+$/, "") + path;
}
