import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellIcon, CloseIcon, LinkIcon, MutedIcon } from "../../components/Icons";
import { useSheet } from "../../hooks/useSheet";
import { type Theme, tokens, useTheme } from "../../theme";
import ConversationRow, { type ConversationAction } from "./ConversationRow";

// A conversation's menu, opened by a long press on its row, as a
// message's is: a scrim over the tab, the row drawn once more as a card
// above a sheet of what web's channel menu offers a conversation: Mute,
// or Unmute once it is muted, Copy link and Close conversation. Each is
// handed to the screen (onAction), which does it and says when one is
// refused, and closes the sheet. A tap on the scrim, a swipe down or
// Android's back closes it with nothing (useSheet).

export default function ConversationMenu({
  dm,
  meId,
  serverId,
  origin,
  token,
  onAction,
  onClose,
}: {
  dm: DirectMessage;
  meId: string;
  serverId: string;
  origin: string;
  token: string;
  onAction: (action: ConversationAction) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const shown = useRef(new Animated.Value(0)).current;
  const { dismiss, closing, onLayout, slide, panHandlers } = useSheet(shown, onClose);

  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: tokens.dur, useNativeDriver: true }).start();
  }, [shown]);

  const muted = dm.channel?.muted ?? false;
  const run = (action: ConversationAction) => () => {
    if (closing()) return;
    onAction(action);
    dismiss();
  };

  const items = [
    muted
      ? { label: "Unmute", icon: <BellIcon color={theme.textMuted} size={22} />, onPress: run("mute") }
      : { label: "Mute", icon: <MutedIcon color={theme.textMuted} size={22} />, onPress: run("mute") },
    { label: "Copy link", icon: <LinkIcon color={theme.textMuted} size={22} />, onPress: run("copyLink") },
    {
      label: "Close conversation",
      icon: <CloseIcon color={theme.textMuted} size={22} />,
      onPress: run("close"),
    },
  ];

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
            testID="conversation-menu-close"
          />
          <Animated.View style={[styles.card, { opacity: shown }]} pointerEvents="none">
            <ConversationRow dm={dm} meId={meId} serverId={serverId} origin={origin} token={token} />
          </Animated.View>
        </View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 8) + 8, transform: [{ translateY: slide }] }]}
          accessibilityRole="menu"
          accessibilityLabel="Conversation actions"
          onLayout={onLayout}
          {...panHandlers}
        >
          <View style={styles.handle} />
          {items.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              onPress={item.onPress}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              {item.icon}
              <Text style={styles.label}>{item.label}</Text>
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
  });
}
