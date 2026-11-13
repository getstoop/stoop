import type { Channel } from "@stoop/gen/stoop/chat/v1/channel_pb";
import type { ReactNode } from "react";
import { BellIcon, InfoIcon, LinkIcon, MutedIcon } from "../../components/Icons";
import MenuSheet from "../../components/MenuSheet";
import { useTheme } from "../../theme";
import { type ChannelAction, channelMenuItems } from "./channelMenuRules";

// A channel's menu, opened by a long press on its row in the pane, as a
// conversation's is: the row drawn once more as a card (a text
// channel's or a voice room's, the pane's to draw) above a sheet
// (MenuSheet) of what ./channelMenuRules.ts offers it. Each is handed
// to the pane (onAction), which does it and says when one is refused.

export default function ChannelMenu({
  channel,
  spaceMuted,
  card,
  onAction,
  onClose,
}: {
  channel: Channel;
  spaceMuted: boolean;
  card: ReactNode;
  onAction: (action: ChannelAction) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const icons: Record<ChannelAction, ReactNode> = {
    mute:
      channel.muted && !spaceMuted ? (
        <BellIcon color={theme.textMuted} size={22} />
      ) : (
        <MutedIcon color={theme.textMuted} size={22} />
      ),
    copyLink: <LinkIcon color={theme.textMuted} size={22} />,
    about: <InfoIcon color={theme.textMuted} size={22} />,
  };

  return (
    <MenuSheet
      label="Channel actions"
      closeTestID="channel-menu-close"
      card={card}
      items={channelMenuItems(channel, spaceMuted).map((item) => ({
        label: item.label,
        icon: icons[item.action],
        disabled: item.disabled,
        onPress: () => onAction(item.action),
      }))}
      onClose={onClose}
    />
  );
}
