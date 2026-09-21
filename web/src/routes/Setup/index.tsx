import { Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useInstanceStatus } from "../../api/queries";
import { AccountStep } from "./AccountStep";
import { InviteStep } from "./InviteStep";
import { ReachStep } from "./ReachStep";
import { type CreatedSpace, SpaceStep } from "./SpaceStep";

// First-run setup for a fresh instance. Four steps on one card: the admin
// account (the first account operates the server), the first space, how
// people will reach the server (skippable; it's also on the admin page),
// and an invite link to hand out. Reached only while the instance has no
// users.

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  "Your account",
  "Your space",
  "Reaching your server",
  "Invite people",
];

export function SetupPage() {
  const { data: status, isLoading } = useInstanceStatus();
  const [step, setStep] = useState<Step>(1);
  const [space, setSpace] = useState<CreatedSpace | null>(null);

  if (isLoading) {
    return <div className="login-page muted">Loading…</div>;
  }
  // Someone else already set the instance up (or this tab is stale).
  if (step === 1 && status && !status.needsSetup) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="login-page">
      <div className="login-card setup-card">
        <h1>Stoop</h1>
        <ol className="setup-steps">
          {STEPS.map((label, i) => {
            const n = (i + 1) as Step;
            const cls = n < step ? "done" : n === step ? "current" : "";
            return (
              <li key={label} className={cls}>
                {n}. {label}
              </li>
            );
          })}
        </ol>
        {step === 1 && <AccountStep onDone={() => setStep(2)} />}
        {step === 2 && (
          <SpaceStep
            onDone={(created) => {
              setSpace(created);
              setStep(3);
            }}
          />
        )}
        {step === 3 && <ReachStep onDone={() => setStep(4)} />}
        {step === 4 && <InviteStep space={space} />}
      </div>
    </div>
  );
}
