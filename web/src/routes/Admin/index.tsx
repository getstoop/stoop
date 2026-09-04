import { Link, Navigate, useSearch } from "@tanstack/react-router";
import { useMe } from "../../api/queries";
import { MenuButton } from "../../components/MenuButton";
import { SettingsFrame } from "../../components/SettingsFrame";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import { AboutSection } from "./AboutSection";
import { CleanupSection } from "./CleanupSection";
import { LoginProvidersSection } from "./LoginProvidersSection";
import { PasswordSignInSection } from "./PasswordSignInSection";
import { ReachabilitySection } from "./ReachabilitySection";
import { ServerSection } from "./ServerSection";
import { StorageSection } from "./StorageSection";
import { UsersSection } from "./UsersSection";

// Server administration: who may create accounts and spaces, which build
// this is, the account list, how people reach the server, sign-in, and
// the upload disk.
// Instance admins only; everyone else is sent home.

type Tab = "server" | "accounts" | "hosting" | "login" | "storage";

const TABS: { key: Tab; label: string }[] = [
  { key: "server", label: "Server" },
  { key: "accounts", label: "Accounts" },
  { key: "hosting", label: "Hosting" },
  { key: "login", label: "Login" },
  { key: "storage", label: "Storage" },
];

export function AdminPage() {
  const { data: me } = useMe();
  const { tab } = useSearch({ strict: false }) as {
    tab?: Exclude<Tab, "server">;
  };
  const active: Tab = tab ?? "server";
  if (!me) return <div className="centered muted">Loading…</div>;
  if (me.role !== InstanceRole.ADMIN) return <Navigate to="/" replace />;
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
      {active === "accounts" && <UsersSection meId={me.id} />}
      {active === "hosting" && <ReachabilitySection />}
      {active === "login" && (
        <>
          <PasswordSignInSection />
          <LoginProvidersSection />
        </>
      )}
      {active === "storage" && (
        <>
          <section className="card">
            <StorageSection />
          </section>
          <section className="card">
            <CleanupSection />
          </section>
        </>
      )}
    </SettingsFrame>
  );
}
