import { Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { chatClient } from "../../api/clients";
import { errorText } from "../../api/errors";
import { inviteLink } from "../../api/invites";
import { useInstanceStatus } from "../../api/queries";
import { CopyButton } from "../../components/CopyButton";
import type { CreatedSpace } from "./SpaceStep";

// The onboarding invite is deliberately generous (a week, unlimited uses)
// so a link pasted into a group chat keeps working; it can be revoked from
// the space's Invite panel.
const ONBOARDING_INVITE_SECONDS = 7 * 24 * 60 * 60;

// Step 4: an invite link to hand out.
export function InviteStep({ space }: { space: CreatedSpace | null }) {
  const navigate = useNavigate();
  const { data: instanceStatus } = useInstanceStatus();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!space) {
    return <Navigate to="/" replace />;
  }

  // Mint the invite once on first render of this step.
  if (link === null && error === null) {
    chatClient
      .createInvite({
        spaceId: space.id,
        expiresIn: { seconds: BigInt(ONBOARDING_INVITE_SECONDS) },
      })
      .then((res) => {
        if (res.invite)
          setLink(
            inviteLink(res.invite.code, space.name, instanceStatus?.publicUrl),
          );
      })
      .catch((err) => setError(errorText(err)));
  }

  const go = () =>
    navigate({
      to: "/s/$spaceId/c/$channelId",
      params: { spaceId: space.id, channelId: space.channelId },
      replace: true,
    });

  return (
    <div className="login-card bare">
      <p>
        <strong>Invite your people to {space.name}.</strong>
      </p>
      <p className="hint">
        Anyone with this link can create an account and join. It works for 7
        days; you can make more (or revoke this one) any time from the Invite
        button in your space.
      </p>
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
      <button type="button" className="primary" onClick={go}>
        Go to your space
      </button>
    </div>
  );
}
