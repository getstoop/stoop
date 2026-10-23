import { messageLinkPath, threadPath } from "@stoop/core/shareLinks";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";

// The link to a message, with the path web builds for Copy link
// (core/shareLinks messageLinkPath: the channel opened around it, or
// the thread for a reply that stays there; /dm/ for a direct message,
// which has no space). The address is the one the phone was
// given for the server (the string its requests go to, no trailing
// slash); web uses the instance's public address instead
// (GetInstanceStatus publicUrl), so a server reached by a LAN address
// links where others can follow. Keeping that beside the saved server
// is a follow-up: the app asks for the status at sign-in and holds
// nothing of it after.
export function messageLink(origin: string, spaceId: string, message: Message): string {
  const { channelId, threadRootId, id, inChannel } = message;
  return origin.replace(/\/+$/, "") + messageLinkPath(spaceId, channelId, id, threadRootId, inChannel);
}

// The same from inside the thread, as web's thread view links its rows:
// a reply, also sent to the channel or not, as the thread opened on it,
// and the root as the channel around it.
export function threadMessageLink(origin: string, spaceId: string, message: Message): string {
  const { channelId, threadRootId, id } = message;
  if (!threadRootId || threadRootId === id) return messageLink(origin, spaceId, message);
  return origin.replace(/\/+$/, "") + threadPath(spaceId, channelId, threadRootId, id);
}
