import { useEmailSettings } from "../../api/queries";
import { SummaryRow } from "./SummaryRow";
import type { Progress, Step } from "./steps";
import { WizardActions } from "./WizardActions";

// After a reload part-way through: what is done, and the way back in.
export function ResumeStep({
  username,
  steps,
  progress,
  onContinue,
  onLater,
}: {
  username: string;
  steps: readonly Step[];
  progress: Progress;
  onContinue: () => void;
  onLater: () => void;
}) {
  const emailHost = useEmailSettings().data?.smtp?.host;
  const left = steps.filter((s) => progress.steps[s.id] === undefined);
  return (
    <div className="login-card bare">
      <p>
        <strong>Welcome back, {username}.</strong>
      </p>
      <p className="hint">Setup isn't finished. Pick up where you left off.</p>
      <ul className="setup-summary">
        {steps
          .filter((s) => progress.steps[s.id] !== undefined)
          .map((s) => (
            <SummaryRow
              key={s.id}
              mark={progress.steps[s.id] === "skipped" ? "skipped" : "done"}
            >
              {s.title}
              {s.id === "space" && progress.space && (
                <strong>{progress.space.name}</strong>
              )}
              {s.id === "email" &&
                progress.steps.email === "done" &&
                emailHost && (
                  <>
                    {" "}
                    via <strong>{emailHost}</strong>
                  </>
                )}
            </SummaryRow>
          ))}
        {left.length > 0 && (
          <SummaryRow mark="left">
            {left.map((s) => s.title).join(", ")}
          </SummaryRow>
        )}
      </ul>
      <WizardActions
        label="Continue setup"
        onLater={onLater}
        onNext={onContinue}
      />
    </div>
  );
}
