import type { DirectMessage } from "@stoop/gen/stoop/chat/v1/chat_pb";
import { BellIcon, CloseIcon, LinkIcon, MutedIcon } from "../../components/Icons";
import MenuSheet from "../../components/MenuSheet";
import { useTheme } from "../../theme";
import ConversationRow, { type ConversationAction } from "./ConversationRow";

// A conversation's menu, opened by a long press on its row, as a
// message's is: the row drawn once more as a card above a sheet
// (MenuSheet) of what web's channel menu offers a conversation: Mute,
// or Unmute once it is muted, Copy link and Close conversation. Each is
// handed to the screen (onAction), which does it and says when one is
// refused, and closes the sheet.

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
  const muted = dm.channel?.muted ?? false;

  return (
    <MenuSheet
      label="Conversation actions"
      closeTestID="conversation-menu-close"
      card={<ConversationRow dm={dm} meId={meId} serverId={serverId} origin={origin} token={token} />}
      items={[
        muted
          ? { label: "Unmute", icon: <BellIcon color={theme.textMuted} size={22} />, onPress: () => onAction("mute") }
          : { label: "Mute", icon: <MutedIcon color={theme.textMuted} size={22} />, onPress: () => onAction("mute") },
        { label: "Copy link", icon: <LinkIcon color={theme.textMuted} size={22} />, onPress: () => onAction("copyLink") },
        {
          label: "Close conversation",
          icon: <CloseIcon color={theme.textMuted} size={22} />,
          onPress: () => onAction("close"),
        },
      ]}
      onClose={onClose}
    />
  );
}
