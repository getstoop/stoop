import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { patchRow } from "../../../api/channelLog";
import { chatClient } from "../../../api/clients";
import { errorText } from "../../../api/errors";
import { setMessagePinned } from "../../../api/pins";
import type { Group } from "../../../gen/stoop/chat/v1/group_pb";
import type { Message } from "../../../gen/stoop/chat/v1/message_pb";
import { confirm, notice } from "../../../stores/dialogs";
import { openSidePanel } from "../../../stores/sidePanel";

// What a row's actions do, and the one card or picker open over the list.
// The handlers take the message and stay stable, so rows stay memoised.
export function useRowHandlers(spaceId: string, channelId: string) {
  const queryClient = useQueryClient();
  const [card, setCard] = useState<{ userId: string; anchor: DOMRect } | null>(
    null,
  );
  const [groupCard, setGroupCard] = useState<{
    group: Group;
    anchor: DOMRect;
  } | null>(null);
  // The reaction picker, open for one message at a time.
  const [picker, setPicker] = useState<{
    message: Message;
    anchor: DOMRect;
  } | null>(null);

  const remove = useCallback(async (message: Message) => {
    const ok = await confirm({
      title: "Delete this message?",
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await chatClient.deleteMessage({ messageId: message.id });
      // Gone from the list at once, as the message_deleted that follows
      // makes it; a root with replies stays as a placeholder, which the
      // server's update for it fills in.
      if (!message.thread)
        patchRow(message.channelId, message.id, (row) => ({
          ...row,
          deleted: true,
        }));
    } catch (err) {
      notice({ title: "Couldn't delete the message", body: errorText(err) });
    }
  }, []);

  // The card goes for everyone; the server's update for the message
  // takes it out of the row.
  const dismissPreview = useCallback(async (message: Message, url: string) => {
    const ok = await confirm({
      title: "Remove this preview?",
      body: "It's removed for everyone.",
      action: "Remove",
    });
    if (!ok) return;
    try {
      await chatClient.dismissLinkPreview({ messageId: message.id, url });
    } catch (err) {
      notice({ title: "Couldn't remove the preview", body: errorText(err) });
    }
  }, []);

  const showCard = useCallback((userId: string, anchor: DOMRect) => {
    setGroupCard(null);
    setCard({ userId, anchor });
  }, []);
  const showGroup = useCallback((group: Group, anchor: DOMRect) => {
    setCard(null);
    setGroupCard({ group, anchor });
  }, []);
  const showPicker = useCallback(
    (message: Message, anchor: DOMRect) => setPicker({ message, anchor }),
    [],
  );
  const togglePin = useCallback(
    (message: Message) =>
      setMessagePinned(queryClient, message, !message.pinned),
    [queryClient],
  );
  const openThreadOf = useCallback(
    (message: Message) =>
      openSidePanel("thread", { spaceId, channelId, rootId: message.id }),
    [spaceId, channelId],
  );
  const openOrigin = useCallback(
    (message: Message) =>
      openSidePanel("thread", {
        spaceId,
        channelId,
        rootId: message.threadRootId,
        focusId: message.id,
      }),
    [spaceId, channelId],
  );

  return {
    card,
    setCard,
    groupCard,
    setGroupCard,
    picker,
    setPicker,
    remove,
    dismissPreview,
    showCard,
    showGroup,
    showPicker,
    togglePin,
    openThreadOf,
    openOrigin,
  };
}
