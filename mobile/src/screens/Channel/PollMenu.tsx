import type { Message } from "@stoop/gen/stoop/chat/v1/message_pb";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { LinkIcon, LockIcon, PinIcon, TrashIcon } from "../../components/Icons";
import Sheet from "../../components/Sheet";
import { type Theme, tokens, useTheme } from "../../theme";
import PollRow from "./PollRow";

// A poll's menu, opened by a long press on its row: the poll drawn once
// more as a card over a sheet (Sheet) of what the reader may do to it, as
// the mockup draws it. Copy link for everyone; Pin message, or Unpin
// message, where the reader may pin (onPin); Close poll for its author,
// or a moderator in a space, while it is open (onClosePoll), the one
// place mobile offers it; Delete poll for the same people, open or
// closed (onDelete). No reactions, reply, thread, quote, edit or Copy
// text: a poll takes none. Close and Delete ask first, in the system's
// confirm, in web's words; Cancel leaves the sheet open. What each does
// to the log, and saying when the server refuses, is the screen's. A
// card taller than its share of the screen (ten options with their
// voters, a large text size) is cut at its foot, so its author and
// question stay in view over the sheet.

// The most of the screen's height the card takes.
const CARD_SHARE = 0.45;
export default function PollMenu({
  message,
  myUserId,
  origin,
  token,
  link,
  onCopyFailed,
  onPin,
  onClosePoll,
  onDelete,
  onClose,
}: {
  message: Message;
  myUserId: string;
  origin: string;
  token: string;
  // The poll's link, ready to copy.
  link: string;
  onCopyFailed: () => void;
  onPin?: () => void;
  onClosePoll?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const most = useWindowDimensions().height * CARD_SHARE;

  return (
    <Sheet
      label="Poll actions"
      menu
      closeTestID="poll-menu-close"
      card={
        <View style={[styles.cut, { maxHeight: most }]}>
          <PollRow message={message} myUserId={myUserId} origin={origin} token={token} card />
        </View>
      }
      onClose={onClose}
    >
      {({ dismiss, closing }) => {
        const items: { label: string; icon: ReactNode; danger?: boolean; testID: string; onPress: () => void }[] = [];
        items.push({
          label: "Copy link",
          icon: <LinkIcon color={theme.textMuted} size={22} />,
          testID: "poll-menu-copy-link",
          onPress: () => {
            Clipboard.setStringAsync(link).then(
              () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
              onCopyFailed,
            );
            dismiss();
          },
        });
        if (onPin) {
          items.push({
            label: message.pinned ? "Unpin message" : "Pin message",
            icon: <PinIcon color={theme.textMuted} filled={message.pinned} />,
            testID: "poll-menu-pin",
            onPress: () => {
              onPin();
              dismiss();
            },
          });
        }
        if (onClosePoll) {
          items.push({
            label: "Close poll",
            icon: <LockIcon color={theme.textMuted} size={22} />,
            testID: "poll-menu-close-poll",
            onPress: () =>
              Alert.alert("Close this poll?", "Voting stops and these results become final. A closed poll can't be reopened.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Close poll",
                  onPress: () => {
                    onClosePoll();
                    dismiss();
                  },
                },
              ]),
          });
        }
        if (onDelete) {
          items.push({
            label: "Delete poll",
            icon: <TrashIcon color={theme.danger} />,
            danger: true,
            testID: "poll-menu-delete",
            onPress: () =>
              Alert.alert("Delete this poll?", "It's removed for everyone, with its votes and results.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => {
                    onDelete();
                    dismiss();
                  },
                },
              ]),
          });
        }
        return items.map((item) => (
          <Pressable
            key={item.label}
            testID={item.testID}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            onPress={() => {
              if (!closing()) item.onPress();
            }}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            {item.icon}
            <Text style={[styles.label, item.danger && styles.danger]}>{item.label}</Text>
          </Pressable>
        ));
      }}
    </Sheet>
  );
}

// As the message menu's items.
function makeStyles(theme: Theme) {
  return StyleSheet.create({
    // Within the card's own corners.
    cut: {
      overflow: "hidden",
      borderRadius: tokens.radiusLg,
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
    danger: {
      color: theme.danger,
    },
  });
}
