import { useQueryClient } from "@tanstack/react-query";
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

  const signOutOthers = async () => {
    if (
      !(await confirm({
        title: "Sign out everywhere else?",
        body: `${others === 1 ? "1 other session" : `${others} other sessions`} will need to sign in again. You stay signed in here.`,
        action: "Sign out",
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authClient.revokeOtherSessions({});
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card sessions-section">
      <h3>Where you're signed in</h3>
      {current && (
        <p className="hint">
          This device: {describeUserAgent(current.userAgent)}. If you don't
          recognise the rest, sign them out and change your password.
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
      {error && <p className="error">{error}</p>}
      <div className="setting-actions">
        <button
          type="button"
          className="chip danger"
          disabled={busy || others === 0}
          onClick={signOutOthers}
        >
          Sign out everywhere else
        </button>
      </div>
    </section>
  );
}
