import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { unreadCounts } from "../api/activity";
import { chatClient } from "../api/clients";
import { useDirectMessages } from "../api/dms";
import { errorText } from "../api/errors";
import { parseInviteCode } from "../api/invites";
import {
  useActivity,
  useInstanceStatus,
  useMe,
  useSpaces,
} from "../api/queries";
import { presenceClass } from "../api/status";
import { badgeCount, isAlerting } from "../api/unreads";
import { startRealtime } from "../api/ws";
import { Avatar } from "../components/Avatar";
import {
  GearIcon,
  MessagesIcon,
  PulseIcon,
  WifiIcon,
} from "../components/Icons";
import { closeDrawerOnLink } from "../components/MenuButton";
import { NavBackdrop } from "../components/NavBackdrop";
import { SpaceIcon } from "../components/SpaceIcon";
import { Tooltip } from "../components/Tooltip";
import { InstanceRole } from "../gen/stoop/auth/v1/auth_pb";
import { SpaceCreationPolicy } from "../gen/stoop/instance/v1/instance_pb";
import { useConnectionStore } from "../stores/connection";
import { notice, prompt } from "../stores/dialogs";
import { useLayoutStore } from "../stores/layout";

// AppShell guards every authenticated route: it verifies the session, owns
// the realtime connection's lifecycle, and renders the space rail.
export function AppShell() {
  const { data: me, isLoading, isError } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();
  const drawerOpen = useLayoutStore((s) => s.drawerOpen);

  useEffect(() => {
    if (!isError) return;
    // Remember where we were headed (e.g. /join/<code>) so login can bring
    // us back. The location is read once here, not subscribed to: this
    // shell stays mounted while the transition to /login is in flight, and
    // reacting to that intermediate location would loop, nesting the
    // redirect param each time.
    const { pathname, searchStr } = router.state.location;
    const here = pathname + searchStr;
    const wantsRedirect = here !== "/" && !pathname.startsWith("/login");
    navigate({
      to: "/login",
      search: wantsRedirect ? { redirect: here } : {},
      replace: true,
    });
  }, [isError, navigate, router]);

  useEffect(() => {
    if (!me) return;
    return startRealtime(queryClient);
  }, [me, queryClient]);

  if (isLoading || isError || !me) {
    return <div className="centered muted">Loading…</div>;
  }

  return (
    <div className={`app-shell ${drawerOpen ? "drawer-open" : ""}`}>
      <SpaceRail />
      <NavBackdrop />
      <Outlet />
    </div>
  );
}

function SpaceRail() {
  const queryClient = useQueryClient();
  const { data: spaces } = useSpaces();
  const { data: me } = useMe();
  const { data: activity } = useActivity();
  const { bySpace: unreadBySpace } = unreadCounts(activity);
  // Direct messages: a dot for anything unread, a badge for alerts (a dm
  // activity item carries no space, so it counts under "").
  const { data: dms } = useDirectMessages();
  const dmUnread = dms?.some(
    (d) => d.channel && isAlerting(queryClient, "", d.channel),
  );
  const dmAlerts = unreadBySpace.get("") ?? 0;
  const { data: instanceStatus } = useInstanceStatus();
  const canCreateSpace =
    me?.role === InstanceRole.ADMIN ||
    instanceStatus?.spaceCreation === SpaceCreationPolicy.EVERYONE;
  const { spaceId } = useParams({ strict: false }) as { spaceId?: string };
  const status = useConnectionStore((s) => s.status);
  const myStatus = useConnectionStore((s) => s.myStatus);
  const navigate = useNavigate();

  const createSpace = async () => {
    const name = await prompt({
      title: "New space",
      label: "Space name",
      action: "Create",
    });
    if (!name) return;
    const res = await chatClient.createSpace({ name });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
    if (res.space && res.defaultChannel) {
      navigate({
        to: "/s/$spaceId/c/$channelId",
        params: { spaceId: res.space.id, channelId: res.defaultChannel.id },
      });
    }
  };

  const joinSpace = async () => {
    const input = await prompt({
      title: "Join a space",
      label: "Invite code or link",
      action: "Join",
    });
    if (!input) return;
    const code = parseInviteCode(input);
    if (!code) return;
    try {
      const res = await chatClient.joinSpace({ code });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      if (res.space) {
        navigate({ to: "/s/$spaceId", params: { spaceId: res.space.id } });
      }
    } catch (err) {
      notice({ title: "Couldn't join", body: errorText(err) });
    }
  };

  return (
    <nav className="space-rail">
      <div className="space-rail-top">
        {/* Not a space, so not in the spaces list: DMs sit above it. */}
        <Link
          to="/dm"
          className="space-pill add dms"
          activeProps={{ className: "space-pill add dms active" }}
          title="Direct messages"
          aria-label="Direct messages"
        >
          <MessagesIcon />
          {dmAlerts > 0 ? (
            <span className="pill-badge">{badgeCount(dmAlerts)}</span>
          ) : (
            dmUnread && <span className="pill-dot" title="Unread messages" />
          )}
        </Link>
        <span className="rail-divider" aria-hidden="true" />
        <div className="space-rail-list">
          {spaces?.map((space) => (
            <Tooltip
              key={space.id}
              text={space.name}
              detail={space.description}
              side="right"
            >
              <Link
                to="/s/$spaceId"
                params={{ spaceId: space.id }}
                className={`space-pill ${space.id === spaceId ? "active" : ""} ${space.muted ? "muted" : ""}`}
                aria-label={space.name}
              >
                <SpaceIcon name={space.name} fileId={space.iconFileId} />
                {/* A muted space draws nothing: no badge, no dot, dimmed
                    like a muted channel row. */}
                {space.muted ? null : (unreadBySpace.get(space.id) ?? 0) > 0 ? (
                  <span className="pill-badge">
                    {badgeCount(unreadBySpace.get(space.id) ?? 0)}
                  </span>
                ) : (
                  space.hasUnread && (
                    <span className="pill-dot" title="Unread messages" />
                  )
                )}
              </Link>
            </Tooltip>
          ))}
          {canCreateSpace && (
            <button
              type="button"
              className="space-pill add"
              onClick={createSpace}
              title="Create a space"
            >
              +
            </button>
          )}
          <button
            type="button"
            className="space-pill add"
            onClick={joinSpace}
            title="Join a space with an invite code"
          >
            →
          </button>
        </div>
      </div>
      <div className="space-rail-footer" onClickCapture={closeDrawerOnLink}>
        <span
          className={`status-icon ${status}`}
          title={`Realtime: ${status}`}
          role="img"
          aria-label={`Realtime connection: ${status}`}
        >
          <WifiIcon />
        </span>
        <Link
          to="/activity"
          className="space-pill add activity"
          activeProps={{ className: "space-pill add activity active" }}
          title="Activity"
          aria-label="Activity"
        >
          <PulseIcon />
          {(activity?.unreadCount ?? 0) > 0 && (
            <span className="pill-dot" title="Unread activity" />
          )}
        </Link>
        {me?.role === InstanceRole.ADMIN && (
          <Link
            to="/admin"
            className="space-pill add"
            activeProps={{ className: "space-pill add active" }}
            title="Server admin"
          >
            <GearIcon />
          </Link>
        )}
        <Link
          to="/profile"
          className="space-pill avatar"
          activeProps={{ className: "space-pill avatar active" }}
          title={me ? `${me.displayName} — profile` : "Profile"}
        >
          {me ? (
            <Avatar name={me.displayName} fileId={me.avatarFileId}>
              <span
                className={`online-dot ${presenceClass(myStatus)}`}
                title={`You're ${presenceClass(myStatus) === "dnd" ? "on do not disturb" : presenceClass(myStatus)}`}
              />
            </Avatar>
          ) : (
            "…"
          )}
        </Link>
      </div>
    </nav>
  );
}
