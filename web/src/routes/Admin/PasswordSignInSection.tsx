import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus, useInstanceUsers } from "../../api/queries";
import { SettingRow } from "../../components/SettingRow";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import { PasswordSignIn } from "../../gen/stoop/instance/v1/instance_pb";

const OPTIONS: { value: PasswordSignIn; label: string; hint: string }[] = [
  {
    value: PasswordSignIn.EVERYONE,
    label: "Everyone",
    hint: "The login page offers a username and password to anyone.",
  },
  {
    value: PasswordSignIn.ADMINS,
    label: "Server admins only",
    hint: "Members sign in with a login provider. The password form is hidden; admins reach it at /login?password=1.",
  },
  {
    value: PasswordSignIn.OFF,
    label: "Off",
    hint: "Everyone signs in with a login provider. The server still honours an admin's password as a fallback.",
  },
];

// Who may use the username/password form. Lives on the Login tab because
// it's a sign-in-method decision, next to the providers it defers to.
export function PasswordSignInSection() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const { data: users } = useInstanceUsers(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = status?.passwordSignIn ?? PasswordSignIn.EVERYONE;
  const hasProviders = (status?.loginProviders.length ?? 0) > 0;
  const restricted = current !== PasswordSignIn.EVERYONE;
  // Provider-created admins have no password: if none does, a dead
  // provider means the CLI is the only way back in.
  const adminWithPassword = users?.some(
    (u) => u.role === InstanceRole.ADMIN && !u.deactivatedAt && u.hasPassword,
  );

  const set = async (value: PasswordSignIn) => {
    setBusy(true);
    setError(null);
    try {
      await instanceClient.updateSettings({ passwordSignIn: value });
      await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const chosen = OPTIONS.find((o) => o.value === current);

  return (
    <section className="card">
      <SettingRow
        id="password-sign-in"
        title="Password sign-in"
        description={
          <>
            {chosen?.hint}
            {!hasProviders &&
              " Add a login provider below before restricting it — otherwise nobody could log in."}
          </>
        }
      >
        <select
          id="password-sign-in"
          name="password-sign-in"
          value={current}
          disabled={busy || !status}
          onChange={(e) => set(Number(e.target.value) as PasswordSignIn)}
        >
          {OPTIONS.map((o) => (
            <option
              key={o.value}
              value={o.value}
              disabled={o.value !== PasswordSignIn.EVERYONE && !hasProviders}
            >
              {o.label}
            </option>
          ))}
        </select>
        {error && <p className="error">{error}</p>}
      </SettingRow>
      {restricted && users && !adminWithPassword && (
        <div className="provider-warning" role="alert">
          <strong>No admin has a password.</strong> If your login provider goes
          down, the way back in is the CLI on the server:{" "}
          <code>stoop admin password-login everyone</code>, or{" "}
          <code>stoop admin reset-password &lt;username&gt;</code> to give an
          admin a password. Setting one on your own profile now avoids that.
        </div>
      )}
    </section>
  );
}
