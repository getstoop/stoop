import { Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isSignedOut } from "../../api/errors";
import { useInstanceStatus, useMe, useSpaces } from "../../api/queries";
import { InstanceRole } from "../../gen/stoop/auth/v1/auth_pb";
import { AccountStep } from "./AccountStep";
import { AddressStep } from "./AddressStep";
import { InviteStep } from "./InviteStep";
import { clearProgress, loadProgress, saveProgress } from "./progress";
import { RemoteStep } from "./RemoteStep";
import { ResumeStep } from "./ResumeStep";
import { SpaceStep } from "./SpaceStep";
import {
  forgetSpace,
  NO_PROGRESS,
  nextStep,
  type Progress,
  previousStep,
  type StepId,
  type StepState,
  visibleSteps,
} from "./steps";
import { VoiceStep } from "./VoiceStep";
import { WizardActions } from "./WizardActions";
import { WizardProgress } from "./WizardProgress";

// First-run setup for a fresh instance, one step at a time on one card
// (the list is in steps.ts). Reached while the instance has no users,
// and again by the admin who started it until they finish, since the
// progress is kept in this browser (progress.ts).

type View = "decide" | "resume" | "steps";

export function SetupPage() {
  const { data: status, isLoading: statusLoading } = useInstanceStatus();
  const { data: me, isLoading: meLoading, error: meError } = useMe();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<Progress>(
    () => loadProgress() ?? NO_PROGRESS,
  );
  const [view, setView] = useState<View>("decide");
  const [currentId, setCurrentId] = useState<StepId | null>(null);

  // A revoked session keeps its cached user beside the signed-out error;
  // that is a sign-in, not a resume.
  const canResume =
    me?.role === InstanceRole.ADMIN &&
    !isSignedOut(meError) &&
    progress.steps.account !== undefined &&
    progress.steps.invite === undefined;
  const { data: spaces, isLoading: spacesLoading } = useSpaces(canResume);

  useEffect(() => {
    if (view !== "decide" || statusLoading || meLoading) return;
    if (status?.needsSetup) {
      // A record left by an earlier instance on this address.
      clearProgress();
      setProgress(NO_PROGRESS);
      setView("steps");
    } else if (canResume && !spacesLoading) {
      const space = progress.space;
      if (space && spaces && !spaces.some((s) => s.id === space.id)) {
        const next = forgetSpace(progress);
        setProgress(next);
        saveProgress(next);
      }
      setView("resume");
    }
  }, [
    view,
    statusLoading,
    meLoading,
    status,
    canResume,
    spacesLoading,
    spaces,
    progress,
  ]);

  if (view === "decide") {
    if (!statusLoading && !meLoading && !status?.needsSetup && !canResume) {
      return <Navigate to="/login" replace />;
    }
    return <div className="login-page muted">Loading…</div>;
  }

  const steps = visibleSteps({
    voiceAvailable: status?.voiceAvailable ?? false,
  });
  const current = currentId
    ? (steps.find((s) => s.id === currentId) ?? nextStep(steps, progress))
    : nextStep(steps, progress);
  const back = previousStep(steps, current.id);
  const goBack = back && (() => setCurrentId(back.id));

  const mark = (id: StepId, state: StepState, extra?: Partial<Progress>) => {
    const next = {
      ...progress,
      ...extra,
      steps: { ...progress.steps, [id]: state },
    };
    setProgress(next);
    saveProgress(next);
    // On to the step after this one, even when it was done before: Back
    // then Continue walks forward rather than jumping ahead.
    const i = steps.findIndex((s) => s.id === id);
    setCurrentId(steps[i + 1]?.id ?? null);
  };

  const goToSpace = () => {
    const space = progress.space;
    if (!space) return navigate({ to: "/", replace: true });
    return navigate({
      to: "/s/$spaceId/c/$channelId",
      params: { spaceId: space.id, channelId: space.channelId },
      replace: true,
    });
  };

  return (
    <div className="login-page">
      <div className="login-card setup-card">
        <h1>Stoop</h1>
        <WizardProgress steps={steps} current={current} progress={progress} />
        {view === "resume" ? (
          <ResumeStep
            username={me?.username ?? ""}
            steps={steps}
            progress={progress}
            onContinue={() => setView("steps")}
            onLater={goToSpace}
          />
        ) : (
          <>
            {current.id === "account" && (
              <AccountStep onDone={() => mark("account", "done")} />
            )}
            {current.id === "space" && (
              <SpaceStep onDone={(space) => mark("space", "done", { space })} />
            )}
            {current.id === "remote" && (
              <RemoteStep
                access={progress.access}
                onDone={(access) => mark("remote", "done", { access })}
                onLater={() => mark("remote", "skipped")}
              />
            )}
            {current.id === "address" && (
              <AddressStep
                access={progress.access}
                onDone={() => mark("address", "done")}
                onBack={goBack}
              />
            )}
            {current.id === "voice" && (
              <VoiceStep
                access={progress.access}
                onDone={() => mark("voice", "done")}
                onBack={goBack}
                onLater={() => mark("voice", "skipped")}
              />
            )}
            {current.id === "invite" && (
              <InviteStep space={progress.space ?? null}>
                <WizardActions
                  label="Go to your space"
                  onBack={goBack}
                  onNext={() => {
                    mark("invite", "done");
                    goToSpace();
                  }}
                />
              </InviteStep>
            )}
          </>
        )}
      </div>
    </div>
  );
}
