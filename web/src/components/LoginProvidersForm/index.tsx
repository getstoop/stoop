import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { instanceClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useInstanceStatus, useLoginProviders } from "../../api/queries";
import { confirm } from "../../stores/dialogs";
import { PencilIcon, PlusIcon, TrashIcon } from "../Icons";
import { ProviderIcon } from "../LoginProviders";
import { type ProviderRowState, requestFrom, rowsFrom } from "./fields";
import { ProviderModal } from "./ProviderModal";

// The configured login providers (OIDC) as a list; each is edited in a
// dialog and every save or removal writes the whole list (the API
// replaces it as one). Secrets are write-only.
export function LoginProvidersForm() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useLoginProviders(true);
  const { data: status } = useInstanceStatus();
  const [editing, setEditing] = useState<ProviderRowState | null | "new">(null);
  const [error, setError] = useState<string | null>(null);

  const rows = data ? rowsFrom(data) : [];
  const publicUrl = status?.publicUrl ?? "";
  // Every provider's callback URL is built from the public URL; without
  // one, no sign-in can even start.
  const noPublicUrl = status !== undefined && publicUrl === "";
  const fromEnv = rows.some((r) => r.fromEnv);

  const persist = async (next: ProviderRowState[]) => {
    await instanceClient.updateLoginProviders(requestFrom(next));
    await queryClient.invalidateQueries({ queryKey: ["login-providers"] });
    await queryClient.invalidateQueries({ queryKey: ["instance-status"] });
  };

  // Saving from the dialog: replace the edited row (matched by its
  // original id) or append the new one.
  const save = async (row: ProviderRowState) => {
    const originalId = editing !== "new" && editing ? editing.id : null;
    const next = originalId
      ? rows.map((r) => (r.id === originalId ? row : r))
      : [...rows, row];
    try {
      await persist(next);
    } catch (err) {
      throw new Error(errorText(err));
    }
    setEditing(null);
  };

  const remove = async (row: ProviderRowState) => {
    const ok = await confirm({
      title: `Remove ${row.displayName || row.id}?`,
      body: "Accounts that signed in with it keep working by password or another provider; their link to this one is dropped.",
      action: "Remove",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await persist(rows.filter((r) => r.id !== row.id));
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (isLoading) return <p className="muted">Loading…</p>;

  return (
    <div className="providers-form">
      {noPublicUrl && (
        <div className="provider-warning" role="alert">
          <strong>Set this server's public URL first.</strong> Login providers
          need it: the callback URL you register with a provider is built from
          it, and sign-in refuses to start without one. Set it under{" "}
          <Link to="/admin" search={{ tab: "hosting" }}>
            Hosting
          </Link>
          .
        </div>
      )}
      {fromEnv && (
        <p className="hint">
          These come from the server's environment (STOOP_OIDC_*). Editing here
          saves a list that overrides them; removing every provider falls back
          to them.
        </p>
      )}
      <div className="provider-list-head">
        <span className="muted small">
          {rows.length === 0
            ? "No login providers yet — people sign in with a username and password."
            : `${rows.length} provider${rows.length === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Add a login provider"
          title="Add a login provider"
          data-add-provider
          onClick={() => setEditing("new")}
        >
          <PlusIcon />
        </button>
      </div>
      {rows.length > 0 && (
        <ul className="user-list">
          {rows.map((r) => (
            <li key={r.id} className="user-row" data-provider-row={r.id}>
              <div className="user-row-main">
                <strong className="user-row-name">
                  <ProviderIcon icon={r.icon} />
                  {r.displayName || r.id}
                </strong>
                <span className="muted small">
                  {r.id} · {r.issuer}
                  {r.fromEnv && <span className="badge">from env</span>}
                </span>
              </div>
              <div className="user-row-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Edit ${r.displayName || r.id}`}
                  title="Edit"
                  data-edit
                  onClick={() => setEditing(r)}
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${r.displayName || r.id}`}
                  title="Remove"
                  data-delete
                  onClick={() => remove(r)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      {editing !== null && (
        <ProviderModal
          initial={editing === "new" ? null : editing}
          takenIds={rows
            .map((r) => r.id)
            .filter((id) => editing === "new" || id !== editing.id)}
          publicUrl={publicUrl}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
