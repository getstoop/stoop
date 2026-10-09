import { Navigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { inviteLink } from "../../api/invites";
import { useInstanceStatus, useMe } from "../../api/queries";
import { CopyButton } from "../../components/CopyButton";
import { isLoopback } from "./loopback";
import type { CreatedSpace } from "./SpaceStep";
import { SummaryRow } from "./SummaryRow";
import type { Progress, Step, StepId } from "./steps";

// The onboarding invite is deliberately generous (a week, unlimited uses)
// so a link pasted into a group chat keeps working; it can be revoked from
// the space's Invite panel.
const ONBOARDING_INVITE_SECONDS = 7 * 24 * 60 * 60;

// An invite link to hand out, and what setup did. The step's actions
// come in as children.
export function InviteStep({
  space,
  steps,
  progress,
  onMinted,
  onGoTo,
  children,
}: {
  space: CreatedSpace | null;
  steps: readonly Step[];
  progress: Progress;
  onMinted: (code: string) => void;
  onGoTo: (id: StepId) => void;
  children: ReactNode;
}) {
  const { data: instanceStatus } = useInstanceStatus();
  const { data: me } = useMe();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const code = progress.invite;
  // The saved code once the server has said it still works.
  const [usable, setUsable] = useState<string | null>(null);

  // Reuse the invite setup made while it still works; mint a new one when
  // there is none, or it has expired or been revoked since.
  useEffect(() => {
    if (!space || busy.current || (code && usable === code)) return;
    busy.current = true;
    const mint = () =>
      chatClient
        .createInvite({
          spaceId: space.id,
          expiresIn: { seconds: BigInt(ONBOARDING_INVITE_SECONDS) },
        })
        .then((res) => {
          if (!res.invite) return;
          setUsable(res.invite.code);
          onMinted(res.invite.code);
        });
    (code
      ? chatClient.lookupInvite({ code }).then(() => setUsable(code), mint)
      : mint()
    )
      .catch((err) => setError(errorText(err)))
      .finally(() => {
        busy.current = false;
      });
  }, [space, code, usable, onMinted]);

  if (!space) {
    return <Navigate to="/" replace />;
  }

  // Built from the address saved now, so a fix on the Address step shows.
  const link =
    code && usable === code
      ? inviteLink(code, space.name, instanceStatus?.publicUrl)
      : null;
  const before = steps.slice(
    0,
    steps.findIndex((s) => s.id === "invite"),
  );

  return (
    <div className="login-card bare">
      <p>
        <strong>Invite your people to {space.name}.</strong>
      </p>
      <p className="hint">Anyone with this link can join for 7 days.</p>
      {link ? (
        <div className="link-box">
          <code title={link}>{link}</code>
          <CopyButton text={link} />
        </div>
      ) : error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <p className="muted">Creating your invite…</p>
      )}
      {link && isLoopback(new URL(link).hostname) && (
        <p className="callout warn">
          This link only opens on this machine.{" "}
          <button
            type="button"
            className="link"
            onClick={() => onGoTo("address")}
          >
            Set an address
          </button>
        </p>
      )}
      <ul className="setup-summary">
        {before.map((s) =>
          progress.steps[s.id] === "skipped" ? (
            <SummaryRow key={s.id} mark="skipped">
              {s.title} skipped
              <button
                type="button"
                className="link small setup-summary-action"
                onClick={() => onGoTo(s.id)}
              >
                Set up
              </button>
            </SummaryRow>
          ) : (
            <SummaryRow key={s.id} mark="done">
              {s.id === "account" ? (
                <>
                  Account <strong>{me?.username}</strong>
                </>
              ) : s.id === "space" ? (
                <>
                  Space <strong>{space.name}</strong>
                </>
              ) : (
                s.title
              )}
            </SummaryRow>
          ),
        )}
      </ul>
      {children}
    </div>
  );
}
