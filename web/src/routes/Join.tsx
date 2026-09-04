import { ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { chatClient } from "../api/clients";
import { parseInviteCode } from "../api/invites";

// /join/$code — reached from a shared link. AppShell has already ensured
// we're logged in (bouncing through /login and back if needed), so all
// that's left is to redeem the code and land in the space.
export function JoinPage() {
  const { code } = useParams({ strict: false }) as { code: string };
  const { space } = useSearch({ strict: false }) as { space?: string };
  const spaceName = space?.trim().slice(0, 100) || undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Guard against StrictMode's double effect: one redemption per visit.
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await chatClient.joinSpace({
          code: parseInviteCode(code),
        });
        await queryClient.invalidateQueries({ queryKey: ["spaces"] });
        if (res.space) {
          navigate({
            to: "/s/$spaceId",
            params: { spaceId: res.space.id },
            replace: true,
          });
        }
      } catch (err) {
        setError(err instanceof ConnectError ? err.rawMessage : String(err));
      }
    })();
  }, [code, navigate, queryClient]);

  if (error) {
    return (
      <div className="centered">
        <div className="empty-state">
          <h2>Couldn't join</h2>
          <p className="error">{error}</p>
          <p className="muted">
            Ask whoever invited you for a fresh code, or{" "}
            <Link to="/">go home</Link>.
          </p>
        </div>
      </div>
    );
  }
  return <div className="centered muted">Joining {spaceName ?? "space"}…</div>;
}
