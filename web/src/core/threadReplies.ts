import {
  type Channel,
  ChannelPostPolicy,
} from "../gen/stoop/chat/v1/channel_pb";
import type { Message } from "../gen/stoop/chat/v1/message_pb";

// Why a thread takes no new replies, in the words its panel says it, or
// null when it takes them: never on a deleted root, never in an
// announcement channel (the server refuses both).
export function threadRepliesClosed(
  channel: Channel | undefined,
  root: Message | undefined,
): string | null {
  if (root?.deleted)
    return "The message this thread started from was deleted, so it takes no new replies.";
  if (channel?.postPolicy === ChannelPostPolicy.ADMINS)
    return "Replies are closed in announcement channels.";
  return null;
}
