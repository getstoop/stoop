import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isAnnouncement } from "../../api/channels";
import { chatClient } from "../../api/clients";
import {
  dmIsGroup,
  dmTitle,
  useChannelRecord,
  useDirectMessages,
} from "../../api/dms";
import { errorText } from "../../api/errors";
import { canDeleteAnyMessage, canPost } from "../../api/permissions";
import {
  useInstanceStatus,
  useMe,
  useMessages,
  useSpaces,
  useThreadRoot,
} from "../../api/queries";
import { copyShareLink, shareUrl, threadPath } from "../../api/shareLinks";
import { setThreadMuted } from "../../api/threads";
import { inChannel } from "../../api/unreads";
import { removeMessageFromCache } from "../../api/ws";
import {
  BellIcon,
  BellOffIcon,
  CheckIcon,
  LinkIcon,
  TrashIcon,
} from "../../components/Icons";
import { useCloseSidePanel } from "../../components/SidePanel/context";
import { SidePanelFrame } from "../../components/SidePanel/SidePanelFrame";
import { SidePanelUnavailable } from "../../components/SidePanel/SidePanelUnavailable";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useAutoReadActivity } from "../../hooks/useAutoRead";
import { useMarkThreadRead } from "../../hooks/useMarkThreadRead";
import { confirm, notice } from "../../stores/dialogs";
import { Composer } from "./Composer";
import { JoinBar } from "./JoinBar";
import { MessageList } from "./MessageList";

// A thread in the side panel: its root, its replies, and a box to reply.
// Params: spaceId ("" for a DM), channelId, rootId, and focusId to open on
// one reply. docs/architecture/web.md → The side panel.
export function ThreadView({ params }: { params: Record<string, string> }) {
  const { spaceId = "", channelId = "", rootId = "", focusId } = params;
  const queryClient = useQueryClient();
  const close = useCloseSidePanel();
  const root = useThreadRoot(channelId, rootId);
  const replies = useMessages({ channelId, rootId }, focusId);
  const { data: me } = useMe();
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === spaceId);
  const { channel } = useChannelRecord(spaceId, channelId);
  const isDM = spaceId === "";
  const { data: dms } = useDirectMessages(isDM);
  const dm = isDM ? dms?.find((d) => d.channel?.id === channelId) : undefined;
  const channelName = isDM
    ? dm
      ? dmTitle(dm, me?.id)
      : ""
    : (channel?.name ?? "");
  const where = isDM ? channelName : `#${channelName}`;
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { data: instanceStatus } = useInstanceStatus();
  // The tick that stands in for the link icon once the link is copied.
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const rootMessage = root.data?.[0];
  const summary = rootMessage?.thread;
  // Nothing is read until the replies are on screen.
  const shown = !!replies.data && !replies.isError;
  useMarkThreadRead(channelId, rootId, shown ? summary : undefined);
  useAutoReadActivity(channelId, rootId, shown);
  // A space that has gone leaves its queries as they were: the spaces
  // list is what says so.
  const spaceGone = !isDM && !!spaces && !space;
  if (
    spaceGone ||
    root.isError ||
    replies.isError ||
    (root.data && !rootMessage)
  ) {
    return (
      <SidePanelFrame title="Thread" subtitle={where}>
        <SidePanelUnavailable message="This thread isn't available any more." />
      </SidePanelFrame>
    );
  }

  const canReply = canPost(space, channel) && !isAnnouncement(channel);
  const closedNote = rootMessage?.deleted
    ? "The message this thread started from was deleted, so it takes no new replies."
    : "Replies are closed in announcement channels.";
  const canModerate = !isDM && !!space && canDeleteAnyMessage(space);
  const deleteThread = async () => {
    const ok = await confirm({
      title: "Delete this thread?",
      body: "The message and every reply in its thread are deleted for everyone.",
      action: "Delete thread",
      danger: true,
    });
    if (!ok) return;
    try {
      await chatClient.deleteThread({ messageId: rootId });
      removeMessageFromCache(queryClient, channelId, rootId);
      close();
    } catch (err) {
      notice({ title: "Couldn't delete the thread", body: errorText(err) });
    }
  };
  const toggleMute = async () => {
    const muted = !summary?.muted;
    try {
      await setThreadMuted(queryClient, channelId, rootId, muted);
    } catch (err) {
      notice({
        title: muted
          ? "Couldn't mute the thread"
          : "Couldn't unmute the thread",
        body: errorText(err),
      });
    }
  };
  const editLast = () => {
    const mine = replies.data?.filter((m) => m.author?.id === me?.id) ?? [];
    const last = mine[mine.length - 1];
    if (last) setEditingId(last.id);
  };

  return (
    <SidePanelFrame
      title="Thread"
      subtitle={where}
      actions={
        <>
          <button
            type="button"
            className="icon-button"
            onClick={async () => {
              const link = shareUrl(
                threadPath(spaceId, channelId, rootId),
                instanceStatus?.publicUrl,
              );
              if (await copyShareLink(link)) setCopied(true);
            }}
            title={copied ? "Copied!" : "Copy link to thread"}
            aria-label={copied ? "Link copied" : "Copy link to thread"}
          >
            {copied ? <CheckIcon /> : <LinkIcon />}
          </button>
          {summary && (
            <button
              type="button"
              className={`icon-button${summary.muted ? " thread-muted-icon" : ""}`}
              onClick={toggleMute}
              title={summary.muted ? "Unmute thread" : "Mute thread"}
              aria-label={summary.muted ? "Unmute thread" : "Mute thread"}
              aria-pressed={summary.muted}
            >
              {summary.muted ? (
                <BellOffIcon size={16} />
              ) : (
                <BellIcon size={16} />
              )}
            </button>
          )}
          {canModerate && (
            <button
              type="button"
              className="icon-button danger"
              onClick={deleteThread}
              title="Delete thread"
              aria-label="Delete thread"
            >
              <TrashIcon />
            </button>
          )}
        </>
      }
      footer={
        channel && !inChannel(channel) ? (
          <JoinBar channel={channel} />
        ) : canReply && !rootMessage?.deleted ? (
          <Composer
            channelId={channelId}
            channelName={channelName}
            dm={isDM}
            group={!!dm && dmIsGroup(dm)}
            spaceId={spaceId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onEditLast={editLast}
            threadRootId={rootId}
          />
        ) : (
          <p className="side-panel-note muted">{closedNote}</p>
        )
      }
    >
      {rootMessage && (
        <MessageList
          messages={replies.data ?? []}
          spaceId={spaceId}
          channelId={channelId}
          channelName={channelName}
          dm={isDM}
          group={!!dm && dmIsGroup(dm)}
          newAfterId={null}
          jumpTarget={focusId}
          editingId={editingId}
          onEdit={setEditingId}
          onReply={setReplyTo}
          threadRoot={rootMessage}
          canWrite={!channel || inChannel(channel)}
        />
      )}
    </SidePanelFrame>
  );
}
