import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fragment } from "react";
import { activityVerb, markActivityRead } from "../../api/activity";
import { useChannels, useMe, useSpaces } from "../../api/queries";
import { messageSearch } from "../../api/shareLinks";
import { Avatar } from "../../components/Avatar";
import { ChannelName } from "../../components/ChannelName";
import { DeletedMark } from "../../components/DeletedMark";
import { ChatBubbleIcon, MailIcon, ReplyIcon } from "../../components/Icons";
import { MutedMark } from "../../components/MutedMark";
import { fullDateTime, shortDateTime } from "../../core/dates";
import {
  type ActivityItem,
  ActivityKind,
} from "../../gen/stoop/chat/v1/activity_pb";
import { splitPreview } from "./preview";

// One thing that happened to you: who did it, with the kind as a glyph
// on their avatar; what they did and where, on one line; and a two-line
// preview with your handle lit. A direct message names no place: the
// verb already does, and a thread's channel is enough beside its verb. Opening it reads it and jumps to the message. `dated`
// is for a row with no day divider above it (the New section): its time
// carries the date once it is more than a day old.
export function ActivityRow({
  item,
  dated = false,
  day,
}: {
  item: ActivityItem;
  dated?: boolean;
  // The day label this row opens, on the first row of a day in the
  // Read section; the rows after it in the same day carry none.
  day?: string;
}) {
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(item.spaceId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const space = spaces?.find((s) => s.id === item.spaceId);
  const channel = channels?.find((c) => c.id === item.channelId);
  const who = item.actor?.displayName || item.actor?.username || "Someone";
  const when = item.createdAt ? timestampDate(item.createdAt) : undefined;

  const open = async () => {
    if (!item.readAt) await markActivityRead(queryClient, [item.id]);
    if (item.spaceId) {
      navigate({
        to: "/s/$spaceId/c/$channelId",
        params: { spaceId: item.spaceId, channelId: item.channelId },
        search: messageSearch(item.messageId, item.threadRootId),
      });
    } else {
      navigate({
        to: "/dm/$channelId",
        params: { channelId: item.channelId },
        search: messageSearch(item.messageId, item.threadRootId),
      });
    }
  };

  return (
    <button
      type="button"
      className={`activity-row ${item.readAt ? "read" : "unread"}`}
      onClick={open}
    >
      {day && <span className="activity-day eyebrow">{day}</span>}
      <span className="activity-avatar">
        <Avatar
          name={who}
          fileId={item.actor?.avatarFileId ?? ""}
          kind={item.actor?.kind}
          size="medium"
        />
        <KindGlyph kind={item.kind} />
      </span>
      <span className="activity-title">
        <strong>{who}</strong>
        <DeletedMark deleted={item.actor?.deleted} />{" "}
        <span className="activity-verb">{activityVerb(item.kind)}</span>
        {item.spaceId && (
          <span className="activity-place">
            {" · "}
            {channel ? <ChannelName channel={channel} /> : "…"}
            {space && (spaces?.length ?? 0) > 1 && ` · ${space.name}`}
          </span>
        )}
        {item.muted && <MutedMark />}
      </span>
      <span
        className="muted small activity-time"
        title={when ? fullDateTime(when) : ""}
      >
        {when ? rowTime(when, dated) : ""}
      </span>
      {item.preview ? (
        <span className="activity-preview">
          {splitPreview(item.preview, me?.username ?? "").map((part, i) =>
            part.mention ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
              <span key={i} className="mention">
                {part.text}
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
              <Fragment key={i}>{part.text}</Fragment>
            ),
          )}
        </span>
      ) : (
        <span className="activity-preview gone">Message deleted</span>
      )}
    </button>
  );
}

// The kind, as a mark on the avatar's corner: @ for a mention, an arrow
// for a reply, a bubble for a thread, an envelope for a direct message.
function KindGlyph({ kind }: { kind: ActivityKind }) {
  const [label, glyph] = (() => {
    switch (kind) {
      case ActivityKind.REPLY:
        return ["Reply", <ReplyIcon key="r" />];
      case ActivityKind.DM:
        return ["Direct message", <MailIcon key="d" />];
      case ActivityKind.THREAD_REPLY:
        return ["Thread reply", <ChatBubbleIcon key="t" />];
      default:
        return ["Mention", "@"];
    }
  })();
  return (
    <span className="activity-kind" title={label}>
      {glyph}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

// A recent row says how long ago. Past a day, a dated row carries the
// date (nothing above it does); an undated row sits under a day
// divider, so it only needs the time of day.
function rowTime(d: Date, dated: boolean): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (dated) return shortDateTime(d);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
