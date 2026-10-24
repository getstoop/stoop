import { COMMON_EMOJI } from "@stoop/core/emoji";
import { plainLines } from "@stoop/core/markdown";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { recentEmoji } from "../../api/emoji";
import {
  CopyIcon,
  LinkIcon,
  PencilIcon,
  QuoteReplyIcon,
  SmileyIcon,
  ThreadIcon,
  TrashIcon,
} from "../../components/Icons";
import { type Theme, tokens, useTheme } from "../../theme";
import EmojiPicker, { type EmojiPickerHandle } from "./EmojiPicker";
import MessageRow from "./MessageRow";
import { useSheet } from "./useSheet";

// The message menu, opened by a long press on a row: a scrim over the
// channel, the message drawn once more as a card above a sheet of the
// quick reactions and the actions the reader may take on it, as the
// mockup draws it. Edit is the author's; Delete is the author's or a
// moderator's (core/permissions canDeleteAnyMessage, as on web). A
// reaction the reader already has is filled. A quick reaction toggles
// itself on the message and closes the sheet; More reactions puts the
// emoji picker (EmojiPicker) in the sheet's place, under the same scrim
// and card, once the phone's recent emoji are read so it is drawn
// final, and a pick there does the same; Copy text puts the message's
// words on the clipboard, as the row draws them, and closes it; Copy
// link does the same with the message's link, as the screen built it,
// and says so (onCopyFailed) when the clipboard refuses; Quote in reply
// hands the message to the screen (onQuote), which holds it as the
// composer's quote and opens the composer once the sheet has gone, and
// Edit message does the same (onEdit) for the composer to edit it;
// Delete message asks first, and the confirm's Delete sends it. What a
// toggle or a delete does to the log is the screen's (useChannelLog
// react and remove), and so is saying when one is refused. Reply in
// thread hands the message to the screen (onThread), which opens its
// thread once the sheet has gone. Either sheet goes on a tap on the scrim, a swipe
// down, or Android's back (useSheet), and the picker's going closes the
// menu with it; a sheet on its way out takes no more taps.

const QUICK_REACTIONS = COMMON_EMOJI.slice(0, 5);

export default function MessageMenu({
  message,
  myUserId,
  canModerate,
  origin,
  token,
  link,
  onReact,
  onCopyFailed,
  onThread,
  onQuote,
  onEdit,
  onDelete,
  onClose,
}: {
  message: Message;
  myUserId: string;
  canModerate: boolean;
  origin: string;
  token: string;
  // The message's link, ready to copy.
  link: string;
  onReact: (emoji: string) => void;
  onCopyFailed: () => void;
  onThread: () => void;
  onQuote: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  // The scrim and the card fade in, and out with whichever sheet is up.
  const shown = useRef(new Animated.Value(0)).current;
  const { dismiss, closing, onLayout, slide, panHandlers } = useSheet(shown, onClose);
  // The picker in the menu's place, with the recent emoji it opens on.
  const [picking, setPicking] = useState<string[] | null>(null);
  const picker = useRef<EmojiPickerHandle>(null);
  const close = () => (picking ? picker.current?.dismiss() : dismiss());
  const openPicker = () => {
    if (closing()) return;
    recentEmoji().then((recent) => {
      if (!closing()) setPicking(recent);
    });
  };

  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown]);

  const mine = message.author?.id === myUserId;
  const replies = message.thread?.replyCount ?? 0;
  const reacted = (emoji: string) =>
    message.reactions.some((group) => group.emoji === emoji && group.userIds.includes(myUserId));

  const react = (emoji: string) => {
    if (closing()) return;
    onReact(emoji);
    dismiss();
  };
  const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  // The words as the row draws them (core/markdown plainLines): a mention
  // as its name, a link as its words or its address, lines kept. A light
  // tap says it happened.
  const copy = () => {
    if (closing()) return;
    Clipboard.setStringAsync(plainLines(message.content)).catch(() => {});
    tap();
    dismiss();
  };
  // The link the same way, the tap only once the clipboard has it; one
  // that refuses it is said, since nothing else shows whether it was
  // copied. The sheet closes either way.
  const copyLink = () => {
    if (closing()) return;
    Clipboard.setStringAsync(link).then(tap, onCopyFailed);
    dismiss();
  };
  const thread = () => {
    if (closing()) return;
    onThread();
    dismiss();
  };
  const quote = () => {
    if (closing()) return;
    onQuote();
    dismiss();
  };
  const edit = () => {
    if (closing()) return;
    onEdit();
    dismiss();
  };
  // The system's confirm over the sheet; Cancel leaves the sheet open.
  const confirmDelete = () =>
    Alert.alert("Delete this message?", "It's removed for everyone and can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          onDelete();
          dismiss();
        },
      },
    ]);

  const items: {
    label: string;
    icon: ReactNode;
    note?: string;
    lead?: boolean;
    danger?: boolean;
    onPress?: () => void;
  }[] = [
    {
      label: "Reply in thread",
      icon: <ThreadIcon color={theme.accent} />,
      note: replies > 0 ? `${replies} ${replies === 1 ? "reply" : "replies"}` : undefined,
      lead: true,
      onPress: thread,
    },
    { label: "Quote in reply", icon: <QuoteReplyIcon color={theme.textMuted} />, onPress: quote },
    { label: "Copy text", icon: <CopyIcon color={theme.textMuted} />, onPress: copy },
    { label: "Copy link", icon: <LinkIcon color={theme.textMuted} size={22} />, onPress: copyLink },
  ];
  if (mine) items.push({ label: "Edit message", icon: <PencilIcon color={theme.textMuted} />, onPress: edit });
  if (mine || canModerate) {
    items.push({
      label: "Delete message",
      icon: <TrashIcon color={theme.danger} />,
      danger: true,
      onPress: confirmDelete,
    });
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.fill} onAccessibilityEscape={close}>
        <Animated.View style={[styles.scrim, { opacity: shown }]} pointerEvents="none" />
        <View style={styles.above}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
            testID="message-menu-close"
          />
          <Animated.View style={[styles.card, { opacity: shown }]} pointerEvents="none">
            <MessageRow message={message} continued={false} myUserId={myUserId} origin={origin} token={token} card />
          </Animated.View>
        </View>
        {picking ? (
          <EmojiPicker ref={picker} shown={shown} recent={picking} reacted={reacted} onPick={onReact} onClose={onClose} />
        ) : (
          <Animated.View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) + 8, transform: [{ translateY: slide }] }]}
            accessibilityRole="menu"
            accessibilityLabel="Message actions"
            onLayout={onLayout}
            {...panHandlers}
          >
            <View style={styles.handle} />
            <View style={styles.reactions}>
              {QUICK_REACTIONS.map((emoji) => {
                const on = reacted(emoji);
                return (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${emoji}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => react(emoji)}
                    style={({ pressed }) => [styles.reaction, on && styles.reacted, pressed && styles.down]}
                  >
                    <Text style={styles.emoji}>{emoji}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More reactions"
                onPress={openPicker}
                style={({ pressed }) => [styles.reaction, pressed && styles.down]}
              >
                <SmileyIcon color={theme.textMuted} />
              </Pressable>
            </View>
            {items.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="menuitem"
                accessibilityLabel={item.note ? `${item.label}, ${item.note}` : item.label}
                onPress={item.onPress ?? dismiss}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                {item.icon}
                <Text style={[styles.label, item.lead && styles.lead, item.danger && styles.danger]}>{item.label}</Text>
                {item.note && <Text style={styles.note}>{item.note}</Text>}
              </Pressable>
            ))}
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
    scrim: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.scrim,
    },
    above: {
      flex: 1,
      justifyContent: "flex-end",
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    card: {
      borderRadius: tokens.radiusLg,
      backgroundColor: theme.surface,
    },
    sheet: {
      paddingTop: 8,
      paddingHorizontal: 8,
      borderTopLeftRadius: tokens.radiusLg,
      borderTopRightRadius: tokens.radiusLg,
      backgroundColor: theme.panel,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 5,
      marginBottom: 12,
      borderRadius: tokens.radiusPill,
      backgroundColor: theme.border,
    },
    reactions: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 8,
      paddingBottom: 12,
    },
    reaction: {
      width: 48,
      height: 48,
      borderRadius: tokens.radiusLg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.raised,
    },
    reacted: {
      backgroundColor: theme.accentSoft,
    },
    down: {
      opacity: 0.85,
    },
    emoji: {
      fontSize: 22,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 52,
      paddingHorizontal: 12,
      borderRadius: tokens.radiusMd,
    },
    pressed: {
      backgroundColor: theme.hover,
    },
    label: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
    },
    lead: {
      fontWeight: "600",
    },
    danger: {
      color: theme.danger,
    },
    note: {
      color: theme.textMuted,
      fontSize: tokens.textUi,
    },
  });
}
