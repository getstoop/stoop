import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useState } from "react";
import { landingChannel } from "../api/channels";
import { chatClient } from "../api/clients";
import { errorText } from "../api/errors";
import { isMuted, mutedByCaller, sidebarTextChannels } from "../api/mutes";
import {
  useActivity,
  useChannels,
  useSpaces,
  useSpaceVoice,
} from "../api/queries";
import {
  copyShareLink,
  shareOrigin,
  shareUrl,
  spacePath,
} from "../api/shareLinks";
import { isAlerting } from "../api/unreads";
import { welcomeSeen } from "../api/welcome";
import { ChannelGlyph } from "../components/ChannelGlyph";
import { ChannelGroupHeading } from "../components/ChannelGroupHeading";
import { ChannelMenu } from "../components/ChannelMenu";
import { DotsMenu, type MenuItem } from "../components/DotsMenu";
import { BellOffIcon } from "../components/Icons";
import { MembersPanel } from "../components/MembersPanel";
import { closeDrawerOnLink } from "../components/MenuButton";
import { MutedBar } from "../components/MutedChannels";
import { MutedMark } from "../components/MutedMark";
import { NewChannelModal } from "../components/NewChannelModal";
import { SpaceAbout } from "../components/SpaceAbout";
import { SpaceIcon } from "../components/SpaceIcon";
import { SpaceWelcome } from "../components/SpaceWelcome";
import { Tooltip } from "../components/Tooltip";
import { VoiceBar } from "../components/VoiceBar";
import { VoiceChannel } from "../components/VoiceChannel";
import { unreadCounts } from "../core/activity";
import { canCreateInvites, canManageChannels } from "../core/permissions";
import { badgeCount } from "../core/unreads";
import { type Channel, ChannelKind } from "../gen/stoop/chat/v1/channel_pb";
import { type Space, SpaceRole } from "../gen/stoop/chat/v1/space_pb";
import { confirm, notice } from "../stores/dialogs";
import { useLayoutStore } from "../stores/layout";
import { openSidePanel } from "../stores/sidePanel";

// Space layout: channel sidebar on the left, the active channel (via
// Outlet) on the right.
export function SpaceLayout() {
  const { spaceId, channelId: openChannelId } = useParams({
    strict: false,
  }) as { spaceId: string; channelId?: string };
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(spaceId);
  const { data: activity } = useActivity();
  const queryClient = useQueryClient();
  const { byChannel: unreadByChannel } = unreadCounts(activity);
  const navigate = useNavigate();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [creating, setCreating] = useState<"text" | "voice" | null>(null);

  const space = spaces?.find((s) => s.id === spaceId);
  const textChannels = sidebarTextChannels(channels, openChannelId);
  const manage = !!space && canManageChannels(space);
  const voiceChannels =
    channels?.filter((c) => c.kind === ChannelKind.VOICE) ?? [];
  // With voice off the server lists no voice channels; this hides the
  // empty group from those who could otherwise add to it.
  const spaceVoice = useSpaceVoice(space);
  const addVoice = manage && spaceVoice;

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
    spaceActions.push({
      label: "Copy link",
      onSelect: () =>
        copyShareLink(shareUrl(spacePath(spaceId), shareOrigin(queryClient))),
      done: "Copied!",
    });
    // Invites live on their settings page, open to anyone who may invite.
    if (canCreateInvites(space)) {
      spaceActions.push({
        label: "Invite people",
        onSelect: () => {
          useLayoutStore.getState().closeDrawer();
          navigate({
            to: "/s/$spaceId/settings",
            params: { spaceId },
            search: { tab: "invites" },
          });
        },
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
    if (!canManageChannels(space)) {
      spaceActions.push({
        label: "Integrations",
        onSelect: () => {
          useLayoutStore.getState().closeDrawer();
          navigate({
            to: "/s/$spaceId/settings",
            params: { spaceId },
            search: { tab: "integrations" },
          });
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

  // A private channel opens on its people, since adding them is the next
  // thing to do; nobody else can see it until then. A voice channel's
  // page is opened by joining it, so only its people open.
  const channelCreated = async (created: Channel) => {
    await queryClient.invalidateQueries({ queryKey: ["channels", spaceId] });
    if (!created.private) return;
    useLayoutStore.getState().closeDrawer();
    if (created.kind !== ChannelKind.VOICE) {
      navigate({
        to: "/s/$spaceId/c/$channelId",
        params: { spaceId, channelId: created.id },
      });
    }
    openSidePanel("people", { spaceId, channelId: created.id });
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
        {aboutOpen && space && (
          <SpaceAbout space={space} onClose={() => setAboutOpen(false)} />
        )}
        {creating && (
          <NewChannelModal
            spaceId={spaceId}
            voice={creating === "voice"}
            onClose={() => setCreating(null)}
            onCreated={channelCreated}
          />
        )}
        <div className="channel-list">
          <ChannelGroupHeading
            label="Text channels"
            add={manage ? "Add channel" : undefined}
            onAdd={() => setCreating("text")}
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
                  <ChannelGlyph channel={channel} />
                  <span className="channel-name">{channel.name}</span>
                  {mutedByCaller(channel) && <MutedMark />}
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
          {(voiceChannels.length > 0 || addVoice) && (
            <ChannelGroupHeading
              label="Voice channels"
              add={addVoice ? "Add voice channel" : undefined}
              onAdd={() => setCreating("voice")}
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
        <MutedBar spaceId={spaceId} channels={channels} />
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
