import { Link } from "@tanstack/react-router";
import { useChannels, useLinkedMessage, useSpaces } from "../api/queries";
import { type LinkedMessage, messageSearch } from "../api/shareLinks";
import { ChannelName } from "./ChannelName";
import { ChatBubbleIcon } from "./Icons";

// A bare link to a message on this server, read as who said it and
// where rather than the address. The address stays one hover away, and
// is what shows until the message has loaded, or for one the reader
// can't see, that is gone, or that is in a private channel: the same
// rule as LinkedMessageCard, whose queries this shares.
export function MessageLink({
  href,
  target,
}: {
  href: string;
  target: LinkedMessage;
}) {
  const { spaceId, channelId, messageId, threadRootId } = target;
  const { data: spaces } = useSpaces();
  const inSpace = !!spaces?.some((space) => space.id === spaceId);
  const { data: channels } = useChannels(inSpace ? spaceId : "");
  const channel = channels?.find((c) => c.id === channelId);
  const shown = !!channel && !channel.private;
  const { data: found } = useLinkedMessage(
    channelId,
    messageId,
    threadRootId,
    shown,
  );
  const message = found?.[0];
  if (!shown || !message || message.deleted) {
    return (
      <a
        className="md-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {href}
      </a>
    );
  }

  const who = message.author?.displayName || message.author?.username || "…";
  return (
    <Link
      className="md-link message-link"
      to="/s/$spaceId/c/$channelId"
      params={{ spaceId, channelId }}
      search={messageSearch(messageId, threadRootId)}
      title={href}
    >
      <ChatBubbleIcon />
      {who} in <ChannelName channel={channel} />
    </Link>
  );
}
