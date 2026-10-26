import type { ChannelLog } from "@stoop/core/channelLog";
import type { GroupedRow } from "@stoop/core/grouping";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import * as Haptics from "expo-haptics";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Alert, type FlatList } from "react-native";
import { errorText } from "../../api/errors";
import type { ChannelEngine } from "./channelEngine";
import type { ComposerHandle } from "./Composer";

// What a screen of messages does with the message menu and its composer,
// shared by the channel and a thread: the message whose menu is open, the
// one the composer quotes and the one it edits, each held by id (never a
// quote and an edit at once), and a line saying what was refused. The
// menu closes with its message (deleted, or left as a placeholder) or
// with the channel; the quote and the edit go with their message,
// silently. A quote or an edit picked opens the composer once the menu
// has gone, and its row is scrolled to the middle of what the keyboard
// leaves, once, while the screen is the one on top (`focused`). Where
// no composer is shown (`composing` false: a thread that takes no
// replies) there is nothing to quote or edit into, and a quote or an
// edit held goes as that starts. A change of `scope` (another channel,
// another thread) lets it all go. A link preview's × asks first, as
// web's does, and takes the card off for everyone.

// How long a refusal's line stays.
const NOTICE_MS = 4000;
// How long after the keyboard is announced the list has made room for it
// (iOS animates the two together, over about a quarter of a second).
const KEYBOARD_SETTLE_MS = 350;

export type Notice = { title: string; body?: string };

export function useMessageActions({
  scope,
  shown,
  log,
  gone,
  engine,
  keyboard,
  focused,
  composing = true,
  list,
  items,
}: {
  scope: string;
  // The messages a menu can be open on.
  shown: Message[];
  log: ChannelLog;
  // The channel has gone, or can't be shown.
  gone: boolean;
  engine: Pick<ChannelEngine, "react" | "remove" | "dismissPreview">;
  keyboard: number;
  focused: boolean;
  composing?: boolean;
  list: RefObject<FlatList<GroupedRow> | null>;
  // The list's rows, newest first.
  items: GroupedRow[];
}) {
  const { react, remove, dismissPreview: dismissCard } = engine;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Whether the composer opens once the menu has gone (a quote or an
  // edit picked), and whether that row is still owed its scroll: once,
  // as the keyboard first comes up for it, never again for a later
  // keyboard.
  const openComposer = useRef(false);
  const scrollOnce = useRef(false);
  const composer = useRef<ComposerHandle>(null);
  // What was refused, for a moment, with the server's reason when there
  // is one: the latest replaces the one before it.
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const shownScope = useRef(scope);
  if (shownScope.current !== scope) {
    shownScope.current = scope;
    if (menuFor) setMenuFor(null);
    if (replyToId) setReplyToId(null);
    if (editingId) setEditingId(null);
    openComposer.current = false;
    scrollOnce.current = false;
  }

  const openMenu = useCallback((message: Message) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setMenuFor(message.id);
  }, []);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const notify = useCallback((title: string, body?: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ title, body });
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const reactTo = useCallback(
    (message: Message, emoji: string) => {
      react(message, emoji).catch((err) => notify("Couldn't react", errorText(err)));
    },
    [react, notify],
  );
  const deleteMessage = useCallback(
    (message: Message) => {
      remove(message).catch((err) => notify("Couldn't delete the message", errorText(err)));
    },
    [remove, notify],
  );
  const linkNotCopied = useCallback(() => notify("Couldn't copy the link"), [notify]);
  const dismissPreview = useCallback(
    (message: Message, url: string) =>
      Alert.alert("Remove this preview?", "It's removed for everyone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            dismissCard(message, url).catch((err) => notify("Couldn't remove the preview", errorText(err)));
          },
        },
      ]),
    [dismissCard, notify],
  );
  const quote = useCallback((message: Message) => {
    setEditingId(null);
    setReplyToId(message.id);
    openComposer.current = true;
    scrollOnce.current = true;
  }, []);
  const startEdit = useCallback((message: Message) => {
    setReplyToId(null);
    setEditingId(message.id);
    openComposer.current = true;
    scrollOnce.current = true;
  }, []);
  const endEdit = useCallback(() => setEditingId(null), []);
  // A refused send's quote coming back: only onto the channel it was for,
  // and not over an edit begun meanwhile.
  const reply = useCallback(
    (message: Message) => {
      if (message.channelId === log.channelId && !editingId) setReplyToId(message.id);
    },
    [log.channelId, editingId],
  );
  const cancelReply = useCallback(() => setReplyToId(null), []);

  const menuMessage = menuFor ? shown.find((message) => message.id === menuFor) : undefined;
  // The menu closes without its own fade, by an abrupt unmount, when the
  // message goes (deleted, or left as a placeholder) or the channel does;
  // the id it held is let go too. A closing animation for these is a
  // later slice's.
  const menuGone = !!menuFor && (!menuMessage || menuMessage.deleted || gone);
  useEffect(() => {
    if (menuGone) setMenuFor(null);
  }, [menuGone]);
  // The composer opens for a quote or an edit once the menu's modal is
  // gone, so its field can take the keyboard.
  useEffect(() => {
    if (menuFor || !openComposer.current) return;
    openComposer.current = false;
    composer.current?.open();
  }, [menuFor]);
  // The quote and the message being edited, as the log holds them; gone
  // with the message.
  const replyRow = replyToId ? log.rows.get(replyToId) : undefined;
  const replyTo = composing && replyRow && !replyRow.deleted ? replyRow : null;
  const replyGone = !!replyToId && !replyTo;
  useEffect(() => {
    if (replyGone) setReplyToId(null);
  }, [replyGone]);
  const editRow = editingId ? log.rows.get(editingId) : undefined;
  const editing = composing && editRow && !editRow.deleted ? editRow : null;
  const editGone = !!editingId && !editing;
  useEffect(() => {
    if (editGone) setEditingId(null);
  }, [editGone]);
  // The list makes room for the keyboard by shrinking from the bottom,
  // and the card floats over its foot, so the quoted or edited row can
  // end up under either: once the keyboard has settled, it is scrolled
  // to the middle of what is left, whether or not it was in view (the
  // list can't tell a row under the card from one in the clear). Once
  // per pick: a later keyboard, with the reader scrolled away to read,
  // leaves the list be. A row the list doesn't hold (a thread's root,
  // over its replies) stays where it is.
  const targetId = replyToId ?? editingId;
  useEffect(() => {
    if (!targetId || keyboard === 0 || !scrollOnce.current || !focused) return;
    const timer = setTimeout(() => {
      scrollOnce.current = false;
      const index = itemsRef.current.findIndex((item) => item.kind === "message" && item.message.id === targetId);
      if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    }, KEYBOARD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [targetId, keyboard, focused, list]);

  // Which ring a row wears: the quote's or the edit's.
  const targetOf = useCallback(
    (message: Message) => (message.id === replyToId ? "reply" : message.id === editingId ? "edit" : undefined),
    [replyToId, editingId],
  );

  return {
    composer,
    menuFor,
    menuMessage: menuMessage && !menuMessage.deleted ? menuMessage : undefined,
    openMenu,
    closeMenu,
    notice,
    notify,
    reactTo,
    deleteMessage,
    dismissPreview,
    linkNotCopied,
    quote,
    startEdit,
    endEdit,
    reply,
    cancelReply,
    replyTo,
    editing,
    targetOf,
  };
}
