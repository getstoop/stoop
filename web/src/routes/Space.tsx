import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useState } from "react";
import { unreadCounts } from "../api/activity";
import { landingChannel } from "../api/channels";
import { chatClient } from "../api/clients";
import { errorText } from "../api/errors";
import { isMuted } from "../api/mutes";
import { canCreateInvites, canManageChannels } from "../api/permissions";
import { useActivity, useChannels, useSpaces } from "../api/queries";
import { badgeCount, isAlerting } from "../api/unreads";
import { welcomeSeen } from "../api/welcome";
import { ChannelGroupHeading } from "../components/ChannelGroupHeading";
import { ChannelMenu } from "../components/ChannelMenu";
import { DotsMenu, type MenuItem } from "../components/DotsMenu";
import { BellOffIcon } from "../components/Icons";
import { InviteModal } from "../components/InviteModal";
import { MembersPanel } from "../components/MembersPanel";
import { closeDrawerOnLink } from "../components/MenuButton";
import { SpaceAbout } from "../components/SpaceAbout";
import { SpaceIcon } from "../components/SpaceIcon";
import { SpaceWelcome } from "../components/SpaceWelcome";
import { Tooltip } from "../components/Tooltip";
import { VoiceBar } from "../components/VoiceBar";
import { VoiceChannel } from "../components/VoiceChannel";
import { ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import { type Space, SpaceRole } from "../gen/stoop/chat/v1/space_pb";
import { confirm, notice, prompt } from "../stores/dialogs";
import { useLayoutStore } from "../stores/layout";

// Space layout: channel sidebar on the left, the active channel (via
// Outlet) on the right.
export function SpaceLayout() {
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(spaceId);
  const { data: activity } = useActivity();
  const queryClient = useQueryClient();
  const { byChannel: unreadByChannel } = unreadCounts(activity);
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const space = spaces?.find((s) => s.id === spaceId);
  const textChannels =
    channels?.filter((c) => c.kind !== ChannelKind.VOICE) ?? [];
  const manage = !!space && canManageChannels(space);
  const voiceChannels =
    channels?.filter((c) => c.kind === ChannelKind.VOICE) ?? [];

  // Kicked, left, or the space was deleted: the list no longer has it.
  if (spaces && !space) {
    return <Navigate to="/" replace />;
  }

  const leaveSpace = async () => {
    if (!space) return;
    const ok = await confirm({
      title: `Leave ${space.name}?`,
      action: "Leave",
      danger: true,
    });
    if (!ok) return;
    try {
      await chatClient.leaveSpace({ spaceId });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
    } catch (err) {
      notice({ title: "Couldn't leave", body: errorText(err) });
    }
  };

  const toggleMute = async () => {
    if (!space) return;
    try {
      const res = await chatClient.setSpaceMuted({
        spaceId,
        muted: !space.muted,
      });
      const muted = res.space?.muted ?? !space.muted;
      queryClient.setQueryData<Space[]>(["spaces"], (old) =>
        old?.map((s) => (s.id === spaceId ? { ...s, muted } : s)),
      );
      // The mute stamps on items already in the feed are now stale.
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    } catch (err) {
      notice({ title: "Couldn't update the space", body: errorText(err) });
    }
  };

  // Everything the space header used to spend its width on. About is here
  // too: it was only reachable by clicking the description, so a space
  // without one had no way in at all.
  const spaceActions: MenuItem[] = [];
  if (space) {
    spaceActions.push({
      label: "About this space",
      onSelect: () => setAboutOpen(true),
    });
    if (canCreateInvites(space)) {
      spaceActions.push({
        label: "Invite people",
        onSelect: () => setInviteOpen(true),
      });
    }
    if (canManageChannels(space)) {
      spaceActions.push({
        label: "Space settings",
        onSelect: () => {
          // A menu item is a button, and only links close the drawer.
          useLayoutStore.getState().closeDrawer();
          navigate({ to: "/s/$spaceId/settings", params: { spaceId } });
        },
      });
    }
    spaceActions.push({
      label: space.muted ? "Unmute space" : "Mute space",
      onSelect: toggleMute,
    });
    if (space.myRole !== SpaceRole.OWNER) {
      spaceActions.push({
        label: "Leave space",
        onSelect: leaveSpace,
        danger: true,
      });
    }
  }

  const createChannel = async (kind: ChannelKind) => {
    const voice = kind === ChannelKind.VOICE;
    const name = await prompt({
      title: voice ? "New voice channel" : "New channel",
      label: voice ? "Voice channel name" : "Channel name",
      action: "Create",
    });
    if (!name) return;
    await chatClient.createChannel({ spaceId, name, kind });
    await queryClient.invalidateQueries({ queryKey: ["channels", spaceId] });
  };

  return (
    <>
      <aside className="channel-sidebar" onClickCapture={closeDrawerOnLink}>
        <header className="sidebar-header">
          <div className="sidebar-header-row">
            {space?.iconFileId && (
              <SpaceIcon
                name={space.name}
                fileId={space.iconFileId}
                className="space-icon header-icon"
              />
            )}
            <span className="space-name">{space?.name ?? "…"}</span>
            {space?.muted && (
              <Tooltip text="Muted" side="bottom">
                <span
                  className="space-muted-icon"
                  role="img"
                  aria-label="Muted"
                >
                  <BellOffIcon />
                </span>
              </Tooltip>
            )}
            {space && (
              <DotsMenu
                label={`Options for ${space.name}`}
                items={spaceActions}
                className="space-menu"
              />
            )}
          </div>
          {space?.description && (
            <Tooltip text={space.description} side="bottom">
              <button
                type="button"
                className="space-desc"
                onClick={() => setAboutOpen(true)}
              >
                {space.description}
              </button>
            </Tooltip>
          )}
        </header>
        {inviteOpen && space && (
          <InviteModal space={space} onClose={() => setInviteOpen(false)} />
        )}
        {aboutOpen && space && (
          <SpaceAbout space={space} onClose={() => setAboutOpen(false)} />
        )}
        <div className="channel-list">
          <ChannelGroupHeading
            label="Text channels"
            add={manage ? "Add channel" : undefined}
            onAdd={() => createChannel(ChannelKind.TEXT)}
          />
          {textChannels.map((channel) => (
            <div key={channel.id} className="channel-row">
              {/* Name over topic, the shape the space rail's pills use.
                  An empty text renders the link alone, so a channel with
                  no topic gets no tooltip repeating its own name. */}
              <Tooltip
                text={channel.topic ? channel.name : undefined}
                detail={channel.topic}
                side="right"
              >
                <Link
                  to="/s/$spaceId/c/$channelId"
                  params={{ spaceId, channelId: channel.id }}
                  className={`channel-link ${isAlerting(queryClient, spaceId, channel) ? "unread" : ""} ${isMuted(queryClient, spaceId, channel.id) ? "muted" : ""}`}
                  activeProps={{
                    className: `channel-link active ${isAlerting(queryClient, spaceId, channel) ? "unread" : ""} ${isMuted(queryClient, spaceId, channel.id) ? "muted" : ""}`,
                  }}
                >
                  <span className="channel-hash">#</span>
                  <span className="channel-name">{channel.name}</span>
                  {(unreadByChannel.get(channel.id) ?? 0) > 0 && (
                    <span className="channel-badge" title="Unread mentions">
                      {badgeCount(unreadByChannel.get(channel.id) ?? 0)}
                    </span>
                  )}
                </Link>
              </Tooltip>
              <ChannelMenu channel={channel} space={space} />
            </div>
          ))}
          {(voiceChannels.length > 0 || manage) && (
            <ChannelGroupHeading
              label="Voice channels"
              add={manage ? "Add voice channel" : undefined}
              onAdd={() => createChannel(ChannelKind.VOICE)}
              divided
            />
          )}
          {voiceChannels.map((channel) => (
            <div key={channel.id} className="channel-row">
              <VoiceChannel spaceId={spaceId} channel={channel} />
              <ChannelMenu channel={channel} space={space} />
            </div>
          ))}
        </div>
        <VoiceBar />
        <MembersPanel spaceId={spaceId} />
      </aside>
      <Outlet />
    </>
  );
}

// /s/$spaceId with no channel selected: the space's welcome the first
// time, otherwise straight on to the channel the space sends arrivals to.
export function SpaceIndex() {
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  const { data: channels, isLoading } = useChannels(spaceId);
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === spaceId);
  const landing = landingChannel(space, channels);

  if (isLoading || !spaces) {
    return <div className="centered muted">Loading…</div>;
  }
  if (space?.welcome && !welcomeSeen(spaceId, space.welcome)) {
    return <SpaceWelcome space={space} channel={landing} />;
  }
  if (landing) {
    return (
      <Navigate
        to="/s/$spaceId/c/$channelId"
        params={{ spaceId, channelId: landing.id }}
      />
    );
  }
  return <div className="centered muted">No channels yet.</div>;
}
