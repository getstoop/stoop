import { COMMON_EMOJI } from "@stoop/core/emoji";
import { plainLines } from "@stoop/core/markdown";
import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, Animated, Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import MessageRow from "./MessageRow";

// The message menu, opened by a long press on a row: a scrim over the
// channel, the message drawn once more as a card above a sheet of the
// quick reactions and the actions the reader may take on it, as the
// mockup draws it. Edit is the author's; Delete is the author's or a
// moderator's (core/permissions canDeleteAnyMessage, as on web). A
// reaction the reader already has is filled. A quick reaction toggles
// itself on the message and closes the sheet; Copy text puts the
// message's words on the clipboard, as the row draws them, and closes
// it; Delete message asks first, and the confirm's Delete sends it.
// What a toggle or a delete does to the log is the screen's
// (useChannelLog react and remove), and so is saying when one is
// refused. The other items are placed and inert: pressing one only
// closes the sheet, until the steps that give them work. The sheet goes
// on a tap on the scrim, a swipe down, or Android's back.

const QUICK_REACTIONS = COMMON_EMOJI.slice(0, 5);
// Off screen until the sheet has been measured.
const OFF = 2000;
// How far, or how fast, a swipe down must go to close the sheet.
const DISMISS_DY = 80;
const DISMISS_VY = 0.6;

export default function MessageMenu({
  message,
  myUserId,
  canModerate,
  origin,
  token,
  onReact,
  onDelete,
  onClose,
}: {
  message: Message;
  myUserId: string;
  canModerate: boolean;
  origin: string;
  token: string;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  // The scrim and the card fade; the sheet slides from its own height
  // below its place, and follows a finger dragging it down.
  const shown = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(OFF)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const height = useRef(0);
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown]);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(shown, { toValue: 0, duration: tokens.dur, useNativeDriver: true }),
      Animated.timing(offset, { toValue: height.current || OFF, duration: tokens.dur, useNativeDriver: true }),
    ]).start(onClose);
  }, [shown, offset, onClose]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => drag.setValue(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > DISMISS_DY || gesture.vy > DISMISS_VY) dismiss();
          else Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: true }).start(),
      }),
    [drag, dismiss],
  );

  const mine = message.author?.id === myUserId;
  const replies = message.thread?.replyCount ?? 0;
  const reacted = (emoji: string) =>
    message.reactions.some((group) => group.emoji === emoji && group.userIds.includes(myUserId));

  const react = (emoji: string) => {
    onReact(emoji);
    dismiss();
  };
  // The words as the row draws them (core/markdown plainLines): a mention
  // as its name, a link as its words or its address, lines kept. A light
  // tap says it happened.
  const copy = () => {
    Clipboard.setStringAsync(plainLines(message.content)).catch(() => {});
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
    },
    { label: "Quote in reply", icon: <QuoteReplyIcon color={theme.textMuted} /> },
    { label: "Copy text", icon: <CopyIcon color={theme.textMuted} />, onPress: copy },
    { label: "Copy link", icon: <LinkIcon color={theme.textMuted} size={22} /> },
  ];
  if (mine) items.push({ label: "Edit message", icon: <PencilIcon color={theme.textMuted} /> });
  if (mine || canModerate) {
    items.push({
      label: "Delete message",
      icon: <TrashIcon color={theme.danger} />,
      danger: true,
      onPress: confirmDelete,
    });
  }

  const slide = Animated.add(
    offset,
    drag.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: "clamp" }),
  );

  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.fill} onAccessibilityEscape={dismiss}>
        <Animated.View style={[styles.scrim, { opacity: shown }]} pointerEvents="none" />
        <View style={styles.above}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={dismiss}
            testID="message-menu-close"
          />
          <Animated.View style={[styles.card, { opacity: shown }]} pointerEvents="none">
            <MessageRow message={message} continued={false} myUserId={myUserId} origin={origin} token={token} card />
          </Animated.View>
        </View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) + 8, transform: [{ translateY: slide }] }]}
          accessibilityRole="menu"
          accessibilityLabel="Message actions"
          onLayout={(event) => {
            if (height.current) return;
            height.current = event.nativeEvent.layout.height;
            offset.setValue(height.current);
            Animated.timing(offset, { toValue: 0, duration: tokens.dur, useNativeDriver: true }).start();
          }}
          {...pan.panHandlers}
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
              onPress={dismiss}
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
