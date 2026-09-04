import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Link, useSearch } from "@tanstack/react-router";
import { useInstanceStatus, useMe } from "../../api/queries";
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

// Your account, in four sections under one header: who other people see
// (Profile), how Stoop looks to you (Appearance), what is allowed to
// interrupt you and how you appear while online (Notifications), and how
// you get in and who you keep out (Security). Log out is the last entry
// of the nav.

type Tab = "profile" | "appearance" | "notifications" | "security";

const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "appearance", label: "Appearance" },
  { key: "notifications", label: "Notifications" },
  { key: "security", label: "Security" },
];

export function ProfilePage() {
  const { data: me } = useMe();
  const { data: status } = useInstanceStatus();
  const search = useSearch({ strict: false }) as {
    tab?: "appearance" | "notifications" | "security";
    linked?: string;
    error?: string;
  };
  // A finished (or failed) provider link lands back here; it belongs to
  // Security, whichever tab the user left from.
  const active: Tab =
    search.tab ?? (search.linked || search.error ? "security" : "profile");
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
      title={TABS.find((t) => t.key === active)?.label ?? "Profile"}
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
      tabs={TABS.map((t) => (
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
        <>
          <section className="card">
            <StatusSection />
            <NotificationsSection />
          </section>
          <MutesSection />
        </>
      )}
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
