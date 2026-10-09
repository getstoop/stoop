// The row under every step: Back on the left, the way on at the right.
// Without onNext the primary button submits the step's form.
export function WizardActions({
  label,
  busy,
  onBack,
  onLater,
  onNext,
}: {
  label: string;
  busy?: boolean;
  onBack?: () => void;
  onLater?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="setup-actions">
      {onBack && (
        <button type="button" className="chip" onClick={onBack}>
          Back
        </button>
      )}
      <span className="setup-actions-gap" />
      {onLater && (
        <button type="button" className="link" onClick={onLater}>
          Set up later
        </button>
      )}
      <button
        type={onNext ? "button" : "submit"}
        className="primary"
        disabled={busy}
        onClick={onNext}
      >
        {label}
      </button>
    </div>
  );
}
