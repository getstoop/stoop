import { Link, Navigate, useSearch } from "@tanstack/react-router";
import { useMe, useMyPermissions } from "../../api/queries";
import { MenuButton } from "../../components/MenuButton";
import { SettingsFrame } from "../../components/SettingsFrame";
import { Permission } from "../../gen/stoop/access/v1/access_pb";
import { AboutSection } from "./AboutSection";
import { CleanupSection } from "./CleanupSection";
import { Diagnostics } from "./Diagnostics";
import { IntegrationsSection } from "./IntegrationsSection";
import { LoginProvidersSection } from "./LoginProvidersSection";
import { PasswordSignInSection } from "./PasswordSignInSection";
import { PersonalTokensSetting } from "./PersonalTokensSetting";
import { ReachabilitySection } from "./ReachabilitySection";
import { RetentionSection } from "./RetentionSection";
import { SelfDeletionSetting } from "./SelfDeletionSetting";
import { ServerSection } from "./ServerSection";
import { SessionLifetimeSetting } from "./SessionLifetimeSetting";
import { SpacesSection } from "./SpacesSection";
import { StorageSection } from "./StorageSection";
import { UsersSection } from "./UsersSection";

// Server administration: who may create accounts and spaces, which build
// this is, the account list, every space on the server, how people reach
// the server, sign-in, the upload disk, and how the server is doing.
// Instance admins only; everyone else is sent home.

type Tab =
  | "server"
  | "accounts"
  | "spaces"
  | "hosting"
  | "login"
  | "storage"
  | "integrations"
  | "diagnostics";

const TABS: { key: Tab; label: string }[] = [
  { key: "server", label: "Server" },
  { key: "accounts", label: "Accounts" },
  { key: "spaces", label: "Spaces" },
  { key: "hosting", label: "Hosting" },
  { key: "login", label: "Login" },
  { key: "storage", label: "Storage" },
  { key: "integrations", label: "Integrations" },
  { key: "diagnostics", label: "Diagnostics" },
];

export function AdminPage() {
  const { data: me } = useMe();
  const { data: permissions } = useMyPermissions();
  const { tab } = useSearch({ strict: false }) as {
    tab?: Exclude<Tab, "server">;
  };
  const active: Tab = tab ?? "server";
  if (!me) return <div className="centered muted">Loading…</div>;
  if (!permissions?.includes(Permission.INSTANCE_READ))
    return <Navigate to="/" replace />;
  return (
    <SettingsFrame
      label="Server admin sections"
      head={
        <header className="profile-header">
          <MenuButton />
          <div>
            <h2>Server admin</h2>
            <p className="muted">Settings for this Stoop instance.</p>
          </div>
        </header>
      }
      title={TABS.find((t) => t.key === active)?.label ?? "Server"}
      tabs={TABS.map((t) => (
        <Link
          key={t.key}
          to="/admin"
          search={t.key === "server" ? {} : { tab: t.key }}
          activeOptions={{ exact: true, includeSearch: true }}
          className="settings-tab"
          data-tab={t.key}
        >
          {t.label}
        </Link>
      ))}
    >
      {active === "server" && (
        <>
          <ServerSection />
          <AboutSection />
        </>
      )}
      {active === "accounts" && (
        <>
          <PersonalTokensSetting />
          <SelfDeletionSetting />
          <UsersSection meId={me.id} />
        </>
      )}
      {active === "spaces" && <SpacesSection />}
      {active === "hosting" && <ReachabilitySection />}
      {active === "login" && (
        <>
          <PasswordSignInSection />
          <SessionLifetimeSetting />
          <LoginProvidersSection />
        </>
      )}
      {active === "integrations" && <IntegrationsSection />}
      {active === "diagnostics" && <Diagnostics />}
      {active === "storage" && (
        <>
          <section className="card">
            <StorageSection />
          </section>
          <section className="card">
            <RetentionSection />
          </section>
          <section className="card">
            <CleanupSection />
          </section>
        </>
      )}
    </SettingsFrame>
  );
}
