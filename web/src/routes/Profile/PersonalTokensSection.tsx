import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus, useMe, usePersonalTokens } from "../../api/queries";
import {
  describePermissions,
  expiryOf,
  lastUsedText,
} from "../../api/tokenOptions";
import { DataTable, type TableColumn } from "../../components/DataTable";
import {
  InstanceRole,
  type PersonalToken,
} from "../../gen/stoop/auth/v1/auth_pb";
import { PersonalTokens } from "../../gen/stoop/instance/v1/instance_pb";
import { confirm } from "../../stores/dialogs";
import { NewTokenModal } from "./NewTokenModal";
import { TokenCreatedModal } from "./TokenCreatedModal";

const isExpired = (t: PersonalToken) =>
  expiryOf(t.expiresAt && timestampDate(t.expiresAt)).state === "expired";

// Security → Personal tokens: a person's own tokens for scripts, each with
// only the permissions it was given (docs/architecture/identity.md).
export function PersonalTokensSection() {
  const queryClient = useQueryClient();
  const { data: tokens } = usePersonalTokens();
  const { data: status } = useInstanceStatus();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{
    name: string;
    secret: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setting = status?.personalTokens ?? PersonalTokens.EVERYONE;
  const allowed =
    setting === PersonalTokens.EVERYONE ||
    (setting === PersonalTokens.ADMINS && me?.role === InstanceRole.ADMIN);

  const revoke = async (t: PersonalToken) => {
    const expired =
      expiryOf(t.expiresAt && timestampDate(t.expiresAt)).state === "expired";
    if (
      !expired &&
      !(await confirm({
        title: `Revoke “${t.name}”?`,
        body: "Anything using it stops working straight away.",
        action: "Revoke",
        danger: true,
      }))
    ) {
      return;
    }
    setError(null);
    try {
      await authClient.revokePersonalToken({ tokenId: t.id });
      await queryClient.invalidateQueries({ queryKey: ["personal-tokens"] });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const latest = useRef(revoke);
  latest.current = revoke;
  const columns = useMemo<TableColumn<PersonalToken>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        accessorFn: (t) => t.name,
        cell: ({ row: { original: t } }) => (
          <>
            <strong>{t.name}</strong>
            <span className="dt-subline muted small">
              <code>…{t.hint}</code>
            </span>
          </>
        ),
      },
      {
        id: "can",
        header: "Can",
        enableSorting: false,
        meta: { width: "32%" },
        cell: ({ row: { original: t } }) =>
          describePermissions(t.permissions).join(", "),
      },
      {
        id: "used",
        header: "Last used",
        accessorFn: (t) =>
          t.lastUsedAt ? timestampDate(t.lastUsedAt).getTime() : 0,
        meta: { width: "14%" },
        cell: ({ row: { original: t } }) =>
          lastUsedText(t.lastUsedAt && timestampDate(t.lastUsedAt)),
      },
      {
        id: "expires",
        header: "Expires",
        // Never expires sorts last.
        accessorFn: (t) =>
          t.expiresAt
            ? timestampDate(t.expiresAt).getTime()
            : Number.MAX_SAFE_INTEGER,
        meta: { width: "14%" },
        cell: ({ row: { original: t } }) => {
          const expiry = expiryOf(t.expiresAt && timestampDate(t.expiresAt));
          if (t.blocked) return <span className="badge">blocked</span>;
          if (expiry.state === "expired")
            return <span className="badge">expired</span>;
          if (expiry.state === "soon")
            return <span className="badge token-soon">{expiry.text}</span>;
          return expiry.text;
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 110, actions: true },
        cell: ({ row: { original: t } }) => (
          <button
            type="button"
            className="chip danger"
            onClick={() => latest.current(t)}
          >
            {isExpired(t) ? "Remove" : "Revoke"}
          </button>
        ),
      },
    ],
    [],
  );

  const hasTokens = (tokens?.length ?? 0) > 0;
  if (!allowed && !hasTokens) {
    return (
      <section className="card personal-tokens">
        <h3>Personal access tokens</h3>
        <p className="hint">
          {setting === PersonalTokens.OFF
            ? "Personal tokens are turned off on this server."
            : "Only server admins can use personal tokens on this server."}
        </p>
      </section>
    );
  }

  return (
    <section className="card personal-tokens">
      <h3>Personal access tokens</h3>
      <p className="hint">
        A token lets a script act as you, with only the permissions you give it.
        It can never change your password, link an account or make another
        token.
      </p>
      {!allowed && (
        <p className="hint">
          {setting === PersonalTokens.OFF
            ? "Personal tokens are turned off on this server, so these don't work right now."
            : "Only server admins can use personal tokens on this server, so these don't work right now."}
        </p>
      )}
      <DataTable
        rows={tokens}
        columns={columns}
        rowId={(t) => t.id}
        noun={["token", "tokens"]}
        empty="No tokens yet."
        rowInactive={isExpired}
        rowProps={(t) => ({ "data-token": t.name })}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {allowed && (
        <div className="setting-actions">
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            New token
          </button>
        </div>
      )}
      {creating && (
        <NewTokenModal
          onClose={() => setCreating(false)}
          onCreated={(name, secret) => {
            setCreating(false);
            setCreated({ name, secret });
          }}
        />
      )}
      {created && (
        <TokenCreatedModal
          name={created.name}
          secret={created.secret}
          onClose={() => setCreated(null)}
        />
      )}
    </section>
  );
}
