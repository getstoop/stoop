import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { authClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { useSessions } from "../../api/queries";
import {
  describeUserAgent,
  type SessionKind,
  sessionKind,
} from "../../api/userAgent";
import { DataTable, type TableColumn } from "../../components/DataTable";
import { confirm } from "../../stores/dialogs";

const KINDS: { kind: SessionKind; label: string }[] = [
  { kind: "desktop", label: "Desktop app" },
  { kind: "web", label: "Web browser" },
  { kind: "mobile", label: "Mobile" },
  { kind: "unknown", label: "Unknown" },
];

// Security → Where you're signed in: how many sessions of each kind, and
// signing out all but this one. A count rather than a row per session:
// the rows were long and told a person little they could act on.
type KindRow = { kind: string; label: string; count: number };

const columns: TableColumn<KindRow>[] = [
  {
    id: "kind",
    header: "Kind",
    cell: ({ row: { original: r } }) => <strong>{r.label}</strong>,
  },
  {
    id: "sessions",
    header: "Sessions",
    meta: { width: 110, align: "end" },
    cell: ({ row: { original: r } }) => r.count,
  },
];

export function SessionsSection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: sessions } = useSessions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = sessions?.find((s) => s.current);
  const others = (sessions?.length ?? 0) - (current ? 1 : 0);
  const rows = useMemo(
    () =>
      sessions &&
      KINDS.map(({ kind, label }) => ({
        kind,
        label,
        count: sessions.filter((s) => sessionKind(s.userAgent) === kind).length,
      })),
    [sessions],
  );

  // Every session goes, this one too, and every personal token: a copy
  // of this session, or a token made from a stolen one, goes with them.
  const signOutEverywhere = async () => {
    if (
      !(await confirm({
        title: "Sign out everywhere?",
        body: `Every device signs out, this one too${others > 0 ? ` (${others + 1} sessions)` : ""}, and your personal tokens stop working. You'll sign in again.`,
        action: "Sign out everywhere",
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authClient.signOutEverywhere({});
      queryClient.clear();
      await navigate({ to: "/login" });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <section className="card sessions-section">
      <h3>Where you're signed in</h3>
      {current && (
        <p className="hint">
          This device: {describeUserAgent(current.userAgent)}. If you don't
          recognise the rest, sign out everywhere, sign back in and change your
          password.
        </p>
      )}
      <DataTable
        rows={rows}
        columns={columns}
        rowId={(r) => r.kind}
        noun={["kind", "kinds"]}
        empty=""
        ordered
        rowProps={(r) => ({ "data-kind": r.kind })}
      />
      <p className="muted small">
        Unknown is a sign-in from a script, or from before Stoop recorded
        devices.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="setting-actions">
        <button
          type="button"
          className="chip danger"
          disabled={busy}
          onClick={signOutEverywhere}
        >
          Sign out everywhere
        </button>
      </div>
    </section>
  );
}
