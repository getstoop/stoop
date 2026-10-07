import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  useMe,
  useMessages,
  useSpaces,
  useThreadRoot,
} from "../../api/queries";
import { removeMessageFromCache } from "../../api/ws";
import { TrashIcon } from "../../components/Icons";
import { useCloseSidePanel } from "../../components/SidePanel/context";
import { SidePanelFrame } from "../../components/SidePanel/SidePanelFrame";
import { SidePanelUnavailable } from "../../components/SidePanel/SidePanelUnavailable";
import type { Message } from "../../gen/stoop/chat/v1/message_pb";
import { confirm, notice } from "../../stores/dialogs";
import { Composer } from "./Composer";
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

  const rootMessage = root.data?.[0];
  if (root.isError || replies.isError || (root.data && !rootMessage)) {
    return (
      <SidePanelFrame title="Thread" subtitle={where}>
        <SidePanelUnavailable message="This thread isn't available any more." />
      </SidePanelFrame>
    );
  }

  const canReply = canPost(space, channel) && !isAnnouncement(channel);
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
        canModerate && (
          <button
            type="button"
            className="icon-button danger"
            onClick={deleteThread}
            title="Delete thread"
            aria-label="Delete thread"
          >
            <TrashIcon />
          </button>
        )
      }
      footer={
        canReply ? (
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
          <p className="side-panel-note muted">
            Replies are closed in announcement channels.
          </p>
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
        />
      )}
    </SidePanelFrame>
  );
}
