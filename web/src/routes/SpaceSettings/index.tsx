import { Link, Navigate, useParams, useSearch } from "@tanstack/react-router";
import { canDeleteSpace, canManageChannels } from "../../api/permissions";
import { useSpaces } from "../../api/queries";
import { MenuButton } from "../../components/MenuButton";
import { SettingsFrame } from "../../components/SettingsFrame";
import { SpaceIcon } from "../../components/SpaceIcon";
import { SpaceRole } from "../../gen/stoop/chat/v1/space_pb";
import { AboutSection } from "./AboutSection";
import { BansSection } from "./BansSection";
import { ChannelsSection } from "./ChannelsSection";
import { DangerSection, InstanceAdminDelete } from "./DangerSection";
import { GeneralSection } from "./GeneralSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { MembersSection } from "./MembersSection";
import { ModerationLegend } from "./ModerationLegend";

// Space settings: everything an admin or the owner manages about a space,
// one section per nav item. Reached from the space menu; members without
// manage_space are sent back to the space. The route sits beside the
// space layout rather than inside it, so the settings nav takes the
// channel sidebar's place.

type Tab =
  | "general"
  | "about"
  | "channels"
  | "members"
  | "banned"
  | "integrations"
  | "owner";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "about", label: "About" },
  { key: "channels", label: "Channels" },
  { key: "members", label: "Members" },
  { key: "banned", label: "Banned" },
  { key: "integrations", label: "Integrations" },
];

// Every member may read Integrations (docs/architecture/integrations.md →
// Who sees what); the rest of the page needs channels.manage.
const MEMBER_TABS = TABS.filter((t) => t.key === "integrations");

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
  if (!manages && active !== "integrations") {
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
  const tabs = !manages ? MEMBER_TABS : ownerTab ? [...TABS, ownerTab] : TABS;
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
      {active === "banned" && <BansSection space={space} />}
      {active === "integrations" && <IntegrationsSection space={space} />}
      {active === "owner" && owner && <DangerSection space={space} />}
      {active === "owner" && !owner && <InstanceAdminDelete space={space} />}
    </SettingsFrame>
  );
}
