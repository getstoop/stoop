import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useNavigate } from "@tanstack/react-router";
import { fullDateTime, shortDateTime } from "../../api/dates";
import { useChannels, useMe } from "../../api/queries";
import { Attachments } from "../../components/Attachments";
import { Avatar } from "../../components/Avatar";
import { MessageBody } from "../../components/MessageBody";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";

// One search result: who said it where and when, then the message with
// the matching words marked. The whole row opens the channel at that
// message.
export function ResultRow({
  message,
  spaceId,
  usernames,
  highlight,
}: {
  message: Message;
  spaceId: string;
  usernames: Set<string>;
  highlight: RegExp | null;
}) {
  const navigate = useNavigate();
  const { data: channels } = useChannels(spaceId);
  const { data: me } = useMe();
  const channel = channels?.find((c) => c.id === message.channelId);
  const who = message.author?.displayName || message.author?.username || "…";
  const when = message.createdAt ? timestampDate(message.createdAt) : null;
  return (
    <button
      type="button"
      className="search-row"
      onClick={() =>
        navigate({
          to: "/s/$spaceId/c/$channelId",
          params: { spaceId, channelId: message.channelId },
          search: { m: message.id },
        })
      }
    >
      <Avatar
        name={who}
        fileId={message.author?.avatarFileId ?? ""}
        size="medium"
      />
      <span className="search-row-title">
        <strong>{who}</strong>
        <span className="muted"> in #{channel?.name ?? "…"}</span>
      </span>
      <span
        className="muted small search-row-time"
        title={when ? fullDateTime(when) : ""}
      >
        {when ? shortDateTime(when) : ""}
      </span>
      <span className="search-row-body message-content">
        <MessageBody
          content={message.content}
          usernames={usernames}
          mentionsEveryone={message.mentionsEveryone}
          mentionsHere={message.mentionsHere}
          myUsername={me?.username}
          highlight={highlight}
        />
        <Attachments attachments={message.attachments} />
      </span>
    </button>
  );
}
