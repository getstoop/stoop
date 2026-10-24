import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  hasOpened,
  holdRow,
  patchRow,
  useOpenView,
  useRow,
  useThreadItems,
  useView,
} from "../../api/channelLog";
import { channelNameText } from "../../api/channels";
import { chatClient } from "../../api/clients";
import {
  dmIsGroup,
  dmTitle,
  useChannelRecord,
  useDirectMessages,
} from "../../api/dms";
import { errorText } from "../../api/errors";
import {
  useInstanceStatus,
  useMe,
  useSpaces,
  useThreadRoot,
} from "../../api/queries";
import { copyShareLink, shareUrl, threadPath } from "../../api/shareLinks";
import { setThreadMuted } from "../../api/threads";
import { ChannelName } from "../../components/ChannelName";
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
import { Tooltip } from "../../components/Tooltip";
import { isShown } from "../../core/channelLog";
import { canDeleteAnyMessage } from "../../core/permissions";
import { threadRepliesClosed } from "../../core/threadReplies";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { useAutoReadActivity } from "../../hooks/useAutoRead";
import { useMarkThreadRead } from "../../hooks/useMarkThreadRead";
import { confirm, notice } from "../../stores/dialogs";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ThreadChannelLink } from "./ThreadChannelLink";

// A thread in the side panel: its root, its replies, and a box to reply.
// Params: spaceId ("" for a DM), channelId, rootId, and focusId to open on
// one reply. docs/architecture/web.md → The side panel.
export function ThreadView({ params }: { params: Record<string, string> }) {
  const { spaceId = "", channelId = "", rootId = "", focusId } = params;
  const queryClient = useQueryClient();
  const close = useCloseSidePanel();
  // The channel's log, held while the thread is open, with the thread's
  // replies as a view on it (or, with focusId, the page around that reply,
  // which the list's jump brings).
  useOpenView({ channelId, rootId }, focusId);
  // The root comes from the log when the channel's page holds it; a
  // thread opened from the activity feed or a link fetches it and hands
  // it to the log, where its edits and summary reach it from then on.
  const held = useRow(channelId, rootId);
  const root = useThreadRoot(channelId, rootId, !held);
  const fetched = root.data?.[0];
  useEffect(() => {
    if (fetched) holdRow(channelId, fetched);
  }, [channelId, fetched]);
  const replies = useThreadItems(channelId, rootId);
  const view = useView(channelId, rootId);
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
    : channel
      ? channelNameText(channel)
      : "";
  const channelLabel =
    !isDM && channel ? <ChannelName channel={channel} /> : channelName;
  // The page beside the thread may be another channel, so the thread says
  // for itself that its own is muted.
  const channelMuted = isDM ? !!dm?.channel?.muted : !!channel?.muted;
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

  // A root held as a tombstone with no replies left is gone, as is one the
  // server has no row for.
  const rootMessage = held && isShown(held) ? held : undefined;
  const rootGone = (held && !isShown(held)) || (root.data && !fetched);
  const summary = rootMessage?.thread;
  // Nothing is read until the replies are on screen.
  const shown = hasOpened(view);
  useMarkThreadRead(channelId, rootId, shown ? summary : undefined);
  useAutoReadActivity(channelId, rootId, shown);
  // A space that has gone leaves its queries as they were: the spaces
  // list is what says so.
  const spaceGone = !isDM && !!spaces && !space;
  if (spaceGone || root.isError || rootGone) {
    return (
      <SidePanelFrame title="Thread" subtitle={channelLabel}>
        <SidePanelUnavailable message="This thread isn't available any more." />
      </SidePanelFrame>
    );
  }

  const closedNote = threadRepliesClosed(channel, rootMessage);
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
      // Gone at once, as the root's message_deleted makes it; the replies'
      // tombstones come with the catch-up its seq asks for.
      patchRow(channelId, rootId, (row) => ({
        ...row,
        deleted: true,
        thread: undefined,
      }));
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
    const mine = replies.filter(
      (m) => m.id !== rootId && m.author?.id === me?.id,
    );
    const last = mine[mine.length - 1];
    if (last) setEditingId(last.id);
  };

  return (
    <SidePanelFrame
      title="Thread"
      subtitle={
        <ThreadChannelLink
          spaceId={spaceId}
          channelId={channelId}
          rootId={rootId}
          label={channelLabel}
        />
      }
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
          {/* A muted channel already silences its threads: the button
              shows that and can't change it. Not `disabled`, which would
              take it out of the tab order and away from its tooltip. */}
          {summary && channelMuted && (
            <Tooltip
              text={isDM ? "Conversation muted" : "Channel muted"}
              detail="Replies in this thread won't notify you."
              side="bottom"
            >
              <button
                type="button"
                className="icon-button thread-channel-muted"
                aria-disabled="true"
                aria-label={
                  isDM
                    ? "Thread muted: its conversation is muted"
                    : "Thread muted: its channel is muted"
                }
              >
                <BellOffIcon size={16} />
              </button>
            </Tooltip>
          )}
          {summary && !channelMuted && (
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
        !closedNote ? (
          <Composer
            channelId={channelId}
            channelName={channelName}
            channelLabel={channelLabel}
            dm={isDM}
            group={!!dm && dmIsGroup(dm)}
            spaceId={spaceId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onReply={setReplyTo}
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
          spaceId={spaceId}
          channelId={channelId}
          channelName={channelName}
          channelLabel={channelLabel}
          dm={isDM}
          group={!!dm && dmIsGroup(dm)}
          newAfterId={null}
          jumpTarget={focusId}
          editingId={editingId}
          onEdit={setEditingId}
          onReply={setReplyTo}
          threadRoot={rootMessage}
        />
      )}
    </SidePanelFrame>
  );
}
