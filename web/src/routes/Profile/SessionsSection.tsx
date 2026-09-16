import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "../../api/clients";
import { shortDateTime } from "../../api/dates";
import { errorText } from "../../api/errors";
import { useSessions } from "../../api/queries";
import { expiryOf, lastUsedText } from "../../api/tokenOptions";
import { describeUserAgent } from "../../api/userAgent";
import { ListHead } from "../../components/ListHead";
import type { Session } from "../../gen/stoop/auth/v1/auth_pb";
import { confirm } from "../../stores/dialogs";

// Security → Where you're signed in: every browser and app holding a
// session, and signing any of the others out. This one leaves through
// Log out in the nav.
export function SessionsSection() {
  const queryClient = useQueryClient();
  const { data: sessions } = useSessions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = sessions?.filter((s) => !s.current) ?? [];

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async (s: Session) => {
    if (
      await confirm({
        title: `Sign out ${describeUserAgent(s.userAgent)}?`,
        body: "It will need to sign in again.",
        action: "Sign out",
        danger: true,
      })
    ) {
      await run(() => authClient.revokeSession({ sessionId: s.id }));
    }
  };

  const signOutOthers = async () => {
    if (
      await confirm({
        title: "Sign out everywhere else?",
        body: `${others.length === 1 ? "1 other session" : `${others.length} other sessions`} will need to sign in again. You stay signed in here.`,
        action: "Sign out",
        danger: true,
      })
    ) {
      await run(() => authClient.revokeOtherSessions({}));
    }
  };

  return (
    <section className="card sessions-section">
      <h3>Where you're signed in</h3>
      <p className="hint">
        If you don't recognise one, sign it out and change your password.
      </p>
      {sessions && (
        <ul className="user-list table five">
          <ListHead
            columns={["Device", "Signed in", "Last active", "Expires", ""]}
          />
          {sessions.map((s) => (
            <li key={s.id} className="user-row" data-session={s.id}>
              <div className="user-row-main">
                <strong title={s.userAgent}>
                  {describeUserAgent(s.userAgent)}
                </strong>
                {s.current && <span className="badge">this device</span>}
              </div>
              <span className="user-cell">
                {s.createdAt && shortDateTime(timestampDate(s.createdAt))}
              </span>
              <span className="user-cell">
                {s.current
                  ? "Now"
                  : lastUsedText(s.lastUsedAt && timestampDate(s.lastUsedAt))}
              </span>
              <span className="user-cell">
                {expiryOf(s.expiresAt && timestampDate(s.expiresAt)).text}
              </span>
              <div className="user-row-actions">
                {!s.current && (
                  <button
                    type="button"
                    className="chip danger"
                    disabled={busy}
                    onClick={() => signOut(s)}
                  >
                    Sign out
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <div className="setting-actions">
        <button
          type="button"
          className="chip danger"
          disabled={busy || others.length === 0}
          onClick={signOutOthers}
        >
          Sign out everywhere else
        </button>
      </div>
    </section>
  );
}
