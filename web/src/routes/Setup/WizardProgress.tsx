import type { Progress, Step } from "./steps";

// One segment per step and the current step named under them: labelled
// segments stop fitting the card at five or six steps.
export function WizardProgress({
  steps,
  current,
  progress,
}: {
  steps: readonly Step[];
  current: Step;
  progress: Progress;
}) {
  const n = steps.indexOf(current) + 1;
  return (
    <div className="setup-progress">
      <ol className="setup-bar" aria-hidden="true">
        {steps.map((s) => (
          <li
            key={s.id}
            className={
              s === current
                ? "current"
                : progress.steps[s.id] !== undefined
                  ? "done"
                  : ""
            }
          />
        ))}
      </ol>
      <p className="setup-where">
        Step {n} of {steps.length} · <strong>{current.title}</strong>
        {current.optional && <span className="setup-optional">Optional</span>}
      </p>
    </div>
  );
}
