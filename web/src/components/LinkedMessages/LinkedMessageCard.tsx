import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Link } from "@tanstack/react-router";
import { useLinkableChannels } from "../../api/channelLinks";
import { useChannelGroups } from "../../api/groups";
import {
  useChannels,
  useLinkedMessage,
  useMe,
  useMembers,
  useSpaces,
} from "../../api/queries";
import { type LinkedMessage, messageSearch } from "../../api/shareLinks";
import { fullDateTime, shortDateTime } from "../../core/dates";
import { mentionMembers } from "../../core/mentions";
import { Attachments } from "../Attachments";
import { Avatar } from "../Avatar";
import { BotMark } from "../BotMark";
import { ChannelName } from "../ChannelName";
import { DeletedMark } from "../DeletedMark";
import { MessageBody } from "../MessageBody";

// The linked message itself: who said it, when and where, then the words
// clamped to a few lines. Nothing for a message the reader can't see, one
// that is gone, or one in a private channel.
export function LinkedMessageCard({ target }: { target: LinkedMessage }) {
  const { spaceId, channelId, messageId, threadRootId } = target;
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const inSpace = !!spaces?.some((space) => space.id === spaceId);
  const { data: channels } = useChannels(inSpace ? spaceId : "");
  const channel = channels?.find((c) => c.id === channelId);
  const shown = !!channel && !channel.private;
  const groups = useChannelGroups(inSpace ? spaceId : "", channelId);
  const linkable = useLinkableChannels(inSpace ? spaceId : "", channelId);
  const { data: members } = useMembers(shown ? spaceId : "");
  const { data: found } = useLinkedMessage(
    channelId,
    messageId,
    threadRootId,
    shown,
  );
  const message = found?.[0];
  if (!shown || !message || message.deleted) return null;

  const who = message.author?.displayName || message.author?.username || "…";
  const when = message.createdAt ? timestampDate(message.createdAt) : null;
  const membersById = mentionMembers(members);
  return (
    <div className="link-preview linked-message">
      <Link
        className="linked-message-head"
        to="/s/$spaceId/c/$channelId"
        params={{ spaceId, channelId }}
        search={messageSearch(messageId, threadRootId)}
      >
        <Avatar
          name={who}
          fileId={message.author?.avatarFileId ?? ""}
          kind={message.author?.kind}
          size="small"
        />
        <span className="linked-message-title">
          <strong>
            {who}
            <BotMark kind={message.author?.kind} />
            <DeletedMark deleted={message.author?.deleted} />
          </strong>
          <span
            className="muted small"
            title={when ? fullDateTime(when) : undefined}
          >
            {when ? shortDateTime(when) : ""}
          </span>
        </span>
        <span className="linked-message-where muted">
          Posted in <ChannelName channel={channel} />
        </span>
      </Link>
      {message.content && (
        <div className="linked-message-body message-content">
          <MessageBody
            content={message.content}
            members={membersById}
            groups={groups}
            channels={linkable}
            mentionsEntireChannel={message.mentionsEntireChannel}
            mentionsHere={message.mentionsHere}
            myUserId={me?.id}
          />
        </div>
      )}
      <Attachments attachments={message.attachments} />
    </div>
  );
}
