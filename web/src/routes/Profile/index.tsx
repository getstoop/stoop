import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Link, useSearch } from "@tanstack/react-router";
import { shellStatus } from "../../api/platform";
import { useInstanceStatus, useMe } from "../../api/queries";
import { useThemeStore } from "../../api/theme";
import { SettingsFrame } from "../../components/SettingsFrame";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import { PasswordSignIn } from "../../gen/stoop/instance/v1/instance_pb";
import { AppearanceSection } from "./AppearanceSection";
import { BlockedSection } from "./BlockedSection";
import { LinkedAccountsSection } from "./LinkedAccountsSection";
import { LogoutButton } from "./LogoutButton";
import { MutesSection } from "./MutesSection";
import { NotificationsSection } from "./NotificationsSection";
import { PasswordForm } from "./PasswordForm";
import { ProfileForm } from "./ProfileForm";
import { ProfileHeader } from "./ProfileHeader";
import { StatusSection } from "./StatusSection";

// Your account, in five sections under one header: who other people see
// (Profile), how Stoop looks to you (Appearance), what is allowed to
// interrupt you and how you appear while online (Notifications), what you
// have silenced (Muted), and how you get in and who you keep out
// (Security). Log out is the last entry of the nav.
//
// Two of them are the shell's inside the desktop app and are not offered
// there: the theme, chosen in its App settings, and — from bridge 3 —
// the status and the banner switch, which the shell keeps for every
// server at once. Both are decided by what the bridge hands over, never
// by "is this the desktop app", so an older shell keeps what it can
// still set for itself.

type Tab = "profile" | "appearance" | "notifications" | "muted" | "security";

const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "appearance", label: "Appearance" },
  { key: "notifications", label: "Notifications" },
  { key: "muted", label: "Muted" },
  { key: "security", label: "Security" },
];

export function ProfilePage() {
  const { data: me } = useMe();
  const { data: status } = useInstanceStatus();
  const shellTheme = useThemeStore((s) => s.shell);
  const search = useSearch({ strict: false }) as {
    tab?: "appearance" | "notifications" | "muted" | "security";
    linked?: string;
    error?: string;
  };
  // A shell that keeps the status keeps the banner switch with it, so
  // both of the Notifications tab's rows are set in App settings and the
  // tab itself would stand empty.
  const shellOwnsStatus = shellStatus() !== undefined;
  const tabs = TABS.filter(
    (t) =>
      (t.key !== "appearance" || !shellTheme) &&
      (t.key !== "notifications" || !shellOwnsStatus),
  );
  // A finished (or failed) provider link lands back here; it belongs to
  // Security, whichever tab the user left from.
  const asked: Tab =
    search.tab ?? (search.linked || search.error ? "security" : "profile");
  // A link to a tab this host does not offer lands on Profile rather than
  // on a heading with nothing under it.
  const active: Tab = tabs.some((t) => t.key === asked) ? asked : "profile";
  if (!me) {
    return <div className="centered muted">Loading…</div>;
  }
  // When password sign-in is restricted, only admins keep a password
  // (their fallback for a dead login provider).
  const passwordsAllowed =
    (status?.passwordSignIn ?? PasswordSignIn.EVERYONE) ===
      PasswordSignIn.EVERYONE || me.role === InstanceRole.ADMIN;
  return (
    <SettingsFrame
      label="Account sections"
      head={<ProfileHeader me={me} />}
      foot={<LogoutButton />}
      title={tabs.find((t) => t.key === active)?.label ?? "Profile"}
      hint={
        active === "profile" && (
          <>
            {me.role === InstanceRole.ADMIN && (
              <span className="badge" title="Operates this server">
                server admin
              </span>
            )}
            {me.createdAt &&
              `Member since ${timestampDate(me.createdAt).toLocaleDateString()}`}
          </>
        )
      }
      tabs={tabs.map((t) => (
        <Link
          key={t.key}
          to="/profile"
          search={t.key === "profile" ? {} : { tab: t.key }}
          // Which tab is lit is decided here
          activeOptions={{ exact: true, includeSearch: true }}
          aria-current={t.key === active ? "page" : undefined}
          className="settings-tab"
          data-tab={t.key}
        >
          {t.label}
        </Link>
      ))}
    >
      {active === "profile" && <ProfileForm me={me} />}
      {active === "appearance" && <AppearanceSection />}
      {active === "notifications" && (
        <section className="card">
          <StatusSection />
          <NotificationsSection />
        </section>
      )}
      {active === "muted" && <MutesSection />}
      {active === "security" && (
        <>
          {passwordsAllowed && <PasswordForm hasPassword={me.hasPassword} />}
          <LinkedAccountsSection />
          <BlockedSection />
        </>
      )}
    </SettingsFrame>
  );
}
