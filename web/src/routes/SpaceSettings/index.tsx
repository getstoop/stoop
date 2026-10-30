import { Link, Navigate, useParams, useSearch } from "@tanstack/react-router";
import { useSpaces } from "../../api/queries";
import { MenuButton } from "../../components/MenuButton";
import { SettingsFrame } from "../../components/SettingsFrame";
import { SpaceIcon } from "../../components/SpaceIcon";
import {
  canCreateInvites,
  canDeleteSpace,
  canManageChannels,
} from "../../core/permissions";
import { type Space, SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import { AboutSection } from "./AboutSection";
import { BansSection } from "./BansSection";
import { ChannelsSection } from "./ChannelsSection";
import { DangerSection, InstanceAdminDelete } from "./DangerSection";
import { GeneralSection } from "./GeneralSection";
import { GroupsSection } from "./GroupsSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { InvitesSection } from "./InvitesSection";
import { MembersSection } from "./MembersSection";
import { ModerationLegend } from "./ModerationLegend";

// Space settings: everything an admin or the owner manages about a space,
// one section per nav item. Reached from the space menu; members without
// manage_space are sent back to the space, except to the sections every
// member may open. The route sits beside the space layout rather than
// inside it, so the settings nav takes the channel sidebar's place.

type Tab =
  | "general"
  | "about"
  | "channels"
  | "members"
  | "groups"
  | "invites"
  | "banned"
  | "integrations"
  | "owner";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "about", label: "About" },
  { key: "channels", label: "Channels" },
  { key: "members", label: "Members" },
  { key: "groups", label: "Groups" },
  { key: "invites", label: "Invites" },
  { key: "banned", label: "Banned" },
  { key: "integrations", label: "Integrations" },
];

// What a member may open: Integrations always
// (docs/architecture/integrations.md → Who sees what), Invites when they
// may invite (then only their own are listed); the rest of the page needs
// channels.manage.
function memberTabs(space: Space) {
  return TABS.filter(
    (t) =>
      t.key === "integrations" ||
      (t.key === "invites" && canCreateInvites(space)),
  );
}

export function SpaceSettingsPage() {
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  const { data: spaces } = useSpaces();
  const { tab } = useSearch({ strict: false }) as {
    tab?: Exclude<Tab, "general">;
  };
  const active: Tab = tab ?? "general";
  const space = spaces?.find((s) => s.id === spaceId);
  if (spaces && !space) return <Navigate to="/" replace />;
  if (!space) return <div className="centered muted">Loading…</div>;
  const manages = canManageChannels(space);
  const memberCanOpen = memberTabs(space).some((t) => t.key === active);
  if (!manages && !memberCanOpen) {
    return <Navigate to="/s/$spaceId" params={{ spaceId }} replace />;
  }
  // The last item is the owner's: transfer and delete. An instance admin
  // who isn't the owner gets the delete alone, under their own name.
  const owner = space.myRole === SpaceRole.OWNER;
  const ownerTab = owner
    ? { key: "owner" as const, label: "Owner" }
    : canDeleteSpace(space)
      ? { key: "owner" as const, label: "Server admin" }
      : null;
  const tabs = !manages
    ? memberTabs(space)
    : ownerTab
      ? [...TABS, ownerTab]
      : TABS;
  return (
    <SettingsFrame
      label="Settings sections"
      head={
        <header className="profile-header">
          <MenuButton />
          <div className="space-settings-title">
            <span className="space-pill static" aria-hidden="true">
              <SpaceIcon name={space.name} fileId={space.iconFileId} />
            </span>
            <div>
              <h2>{space.name}</h2>
              <p className="muted">Space settings</p>
            </div>
          </div>
          <Link to="/s/$spaceId" params={{ spaceId }} className="chip">
            Back to space
          </Link>
        </header>
      }
      title={tabs.find((t) => t.key === active)?.label ?? "General"}
      tabs={tabs.map((t) => (
        <Link
          key={t.key}
          to="/s/$spaceId/settings"
          params={{ spaceId }}
          search={t.key === "general" ? {} : { tab: t.key }}
          activeOptions={{ exact: true, includeSearch: true }}
          className={`settings-tab ${t.key === "owner" ? "danger" : ""}`}
          data-tab={t.key}
        >
          {t.label}
        </Link>
      ))}
    >
      {active === "general" && <GeneralSection space={space} />}
      {active === "about" && <AboutSection space={space} />}
      {active === "channels" && <ChannelsSection space={space} />}
      {active === "members" && (
        <>
          <MembersSection space={space} />
          <ModerationLegend />
        </>
      )}
      {active === "groups" && <GroupsSection space={space} />}
      {active === "invites" && <InvitesSection space={space} />}
      {active === "banned" && <BansSection space={space} />}
      {active === "integrations" && <IntegrationsSection space={space} />}
      {active === "owner" && owner && <DangerSection space={space} />}
      {active === "owner" && !owner && <InstanceAdminDelete space={space} />}
    </SettingsFrame>
  );
}
