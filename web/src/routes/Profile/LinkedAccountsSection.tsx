import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { type MouseEvent, useMemo, useRef, useState } from "react";
import { authClient } from "../../api/clients";
import { beginDesktopAuth } from "../../api/desktopAuth";
import { errorText } from "../../api/errors";
import { linkErrorText } from "../../api/loginErrors";
import { isDesktop } from "../../api/platform";
import { useIdentities, useInstanceStatus } from "../../api/queries";
import { DataTable, type TableColumn } from "../../components/DataTable";
import {
  ProviderIcon,
  providerShortName,
  startURL,
} from "../../components/LoginProviders";
import type { Identity } from "../../gen/stoop/auth/v1/auth_pb";

// The login providers attached to this account: sign in with any of
// them, link more, or unlink. Hidden when the server has no providers
// and nothing is linked.
export function LinkedAccountsSection() {
  const queryClient = useQueryClient();
  const { data: status } = useInstanceStatus();
  const { data: identities } = useIdentities();
  const search = useSearch({ strict: false }) as {
    linked?: string;
    error?: string;
  };
  const [error, setError] = useState<string | null>(
    search.error ? linkErrorText(search.error) : null,
  );

  const latest = useRef<{
    nameOf: (id: string) => string;
    iconOf: (id: string) => string;
    unlink: (provider: string) => void;
  } | null>(null);
  const columns = useMemo<TableColumn<Identity>[]>(
    () => [
      {
        id: "provider",
        header: "Provider",
        enableSorting: false,
        cell: ({ row: { original: i } }) => (
          <strong className="user-row-name">
            <ProviderIcon icon={latest.current?.iconOf(i.provider) ?? ""} />
            {latest.current?.nameOf(i.provider)}
          </strong>
        ),
      },
      {
        id: "account",
        header: "Account",
        enableSorting: false,
        meta: { width: "45%" },
        cell: ({ row: { original: i } }) => i.email,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 110, actions: true },
        cell: ({ row: { original: i } }) => (
          <button
            type="button"
            className="chip"
            onClick={() => latest.current?.unlink(i.provider)}
          >
            Unlink
          </button>
        ),
      },
    ],
    [],
  );

  const providers = status?.loginProviders ?? [];
  const linked = identities ?? [];
  if (providers.length === 0 && linked.length === 0) return null;

  const nameOf = (id: string) =>
    providerShortName(providers.find((p) => p.id === id)?.displayName ?? id);
  const iconOf = (id: string) => providers.find((p) => p.id === id)?.icon ?? "";
  const unlinked = providers.filter(
    (p) => !linked.some((i) => i.provider === p.id),
  );

  // In the desktop shell the provider leg leaves for the system browser
  // and the identity attaches when the stoop://auth hand-back lands
  // (api/desktopAuth.ts); providers refuse an embedded view.
  const connect = async (
    id: string,
    href: string,
    e: MouseEvent<HTMLAnchorElement>,
  ) => {
    if (!isDesktop()) return;
    e.preventDefault();
    setError(null);
    try {
      const url = await beginDesktopAuth(id, href, { link: true });
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const unlink = async (provider: string) => {
    setError(null);
    try {
      await authClient.unlinkIdentity({ provider });
      await queryClient.invalidateQueries({ queryKey: ["identities"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError(errorText(err));
    }
  };

  latest.current = { nameOf, iconOf, unlink };

  return (
    <section className="card linked-accounts">
      <h3>Linked accounts</h3>
      <p className="hint">
        Sign in with any of these instead of a password. The provider is only
        consulted at sign-in.
      </p>
      {search.linked && (
        <p className="muted small">Linked {nameOf(search.linked)}.</p>
      )}
      {linked.length > 0 && (
        <DataTable
          rows={linked}
          columns={columns}
          rowId={(i) => i.provider}
          noun={["account", "accounts"]}
          empty=""
        />
      )}
      {unlinked.length > 0 && (
        <div className="provider-add">
          {unlinked.map((p) => {
            const href = startURL(p.id, { link: true });
            return (
              <a
                key={p.id}
                className="chip"
                data-provider={p.id}
                href={href}
                onClick={(e) => void connect(p.id, href, e)}
              >
                Connect {providerShortName(p.displayName)}
              </a>
            );
          })}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
