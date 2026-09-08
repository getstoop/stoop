// The card that asks whether the identity the round trip found is the
// one the person meant. It is the only check on *whose* identity came
// back: the attempt's verifier proves which window started the round
// trip, not who finished it.
// docs/architecture/identity.md → What a stolen attempt id can do.
export function DesktopLinkConfirm({
  provider,
  email,
  busy,
  onConfirm,
  onCancel,
}: {
  provider: string;
  email: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <h1>Connect {provider}?</h1>
      <p className="login-subtitle">
        {email ? (
          <>
            <strong>{email}</strong> will be able to sign in to your account.
          </>
        ) : (
          <>This {provider} account will be able to sign in to your account.</>
        )}
      </p>
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={onConfirm}
      >
        Connect
      </button>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
      <p className="muted small">
        Cancel if you don't recognise it — nothing is connected until you say
        so.
      </p>
    </>
  );
}
