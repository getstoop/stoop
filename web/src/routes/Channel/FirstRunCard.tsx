import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { inviteGone, inviteLink } from "../../api/invites";
import { useInstanceStatus, useInvitePreview, useMe } from "../../api/queries";
import { CopyButton } from "../../components/CopyButton";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import { clearProgress, loadProgress } from "../Setup/progress";
import { SummaryRow } from "../Setup/SummaryRow";
import { STEPS } from "../Setup/steps";

// After setup, at the top of the space it made: the invite link again,
// and whatever was left for later. Only in the browser that ran setup,
// since that is where its progress is kept, until dismissed.
export function FirstRunCard({ channelId }: { channelId: string }) {
  const { data: me } = useMe();
  const { data: status } = useInstanceStatus();
  const [progress, setProgress] = useState(loadProgress);
  // The invite may have expired or been revoked since setup made it.
  const { isSuccess: inviteWorks, error: inviteError } = useInvitePreview(
    progress?.invite,
  );
  const inviteDead = inviteGone(inviteError);

  const space = progress?.space;
  if (
    !progress?.invite ||
    !space ||
    space.channelId !== channelId ||
    progress.steps.invite !== "done" ||
    me?.role !== InstanceRole.ADMIN
  ) {
    return null;
  }

  const link = inviteLink(progress.invite, space.name, status?.publicUrl);
  const skipped = STEPS.filter((s) => progress.steps[s.id] === "skipped");
  const dismiss = () => {
    clearProgress();
    setProgress(null);
  };

  return (
    <section className="first-run" aria-label="Finish setting up">
      <p>
        <strong>Your server is up. Bring people in.</strong>
      </p>
      <p className="hint">Only you see this.</p>
      {inviteWorks && (
        <div className="link-box">
          <code title={link}>{link}</code>
          <CopyButton text={link} />
        </div>
      )}
      {inviteDead && (
        <p className="hint">
          Setup's invite no longer works. Make a new one from Invite people.
        </p>
      )}
      {skipped.length > 0 && (
        <ul className="setup-summary">
          {skipped.map((s) => (
            <SummaryRow key={s.id} mark="skipped">
              {s.title} skipped
              <Link
                to="/admin"
                search={{ tab: "hosting" }}
                className="small setup-summary-action"
              >
                Set up
              </Link>
            </SummaryRow>
          ))}
        </ul>
      )}
      <div className="setup-actions">
        <span className="setup-actions-gap" />
        <button type="button" className="link" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
