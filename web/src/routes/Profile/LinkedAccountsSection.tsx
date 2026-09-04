import { useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { linkErrorText } from "../../api/loginErrors";
import { useIdentities, useInstanceStatus } from "../../api/queries";
import { ListHead } from "../../components/ListHead";
import {
  ProviderIcon,
  providerShortName,
  startURL,
} from "../../components/LoginProviders";

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

  const providers = status?.loginProviders ?? [];
  const linked = identities ?? [];
  if (providers.length === 0 && linked.length === 0) return null;

  const nameOf = (id: string) =>
    providerShortName(providers.find((p) => p.id === id)?.displayName ?? id);
  const iconOf = (id: string) => providers.find((p) => p.id === id)?.icon ?? "";
  const unlinked = providers.filter(
    (p) => !linked.some((i) => i.provider === p.id),
  );

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
        <ul className="user-list table">
          <ListHead columns={["Provider", "Account", ""]} />
          {linked.map((i) => (
            <li key={i.provider} className="user-row">
              <div className="user-row-main">
                <strong className="user-row-name">
                  <ProviderIcon icon={iconOf(i.provider)} />
                  {nameOf(i.provider)}
                </strong>
              </div>
              <span className="user-cell">{i.email}</span>
              <div className="user-row-actions">
                <button
                  type="button"
                  className="chip"
                  onClick={() => unlink(i.provider)}
                >
                  Unlink
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {unlinked.length > 0 && (
        <div className="provider-add">
          {unlinked.map((p) => (
            <a
              key={p.id}
              className="chip"
              data-provider={p.id}
              href={startURL(p.id, { link: true })}
            >
              Connect {providerShortName(p.displayName)}
            </a>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
