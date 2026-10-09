import { Code, ConnectError } from "@connectrpc/connect";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { authClient } from "../../../api/clients";
import { errorText } from "../../../api/errors";
import { useMyEmail } from "../../../api/queries";
import type {
  GetMeResponse,
  MyEmail,
} from "../../../gen/stoop/auth/v1/auth_pb";
import { AddressForm } from "./AddressForm";
import { RemoveForm } from "./RemoveForm";
import { emailActions, emailState } from "./state";

// The account's email address: none, one waiting for its link, or a
// confirmed one (with perhaps a change waiting). Only the person and
// admins see it.
export function EmailSection({ hasPassword }: { hasPassword: boolean }) {
  const queryClient = useQueryClient();
  const { data: email } = useMyEmail();
  const [open, setOpen] = useState<"address" | "remove" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const state = emailState(email);
  const actions = emailActions(state);

  // A note or refusal is about the state it was given in; when the state
  // moves (a link confirmed in another tab), it goes.
  const [shownFor, setShownFor] = useState(state);
  if (shownFor !== state) {
    setShownFor(state);
    setNote(null);
    setError(null);
  }

  // While a link is out, coming back to this tab may follow a confirmation
  // somewhere else: read the address again.
  const waiting = state === "pending" || state === "changing";
  useEffect(() => {
    if (!waiting) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [waiting, queryClient]);

  const showEmail = async (next: MyEmail | undefined) => {
    if (next) {
      queryClient.setQueryData<GetMeResponse>(
        ["me"],
        (old) => old && { ...old, email: next },
      );
    } else {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  };

  // One call at a time: a second Resend would revoke the first link.
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setNote(null);
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
      // Refused because the state changed elsewhere: show what is there now.
      if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = () =>
    run(async () => {
      await authClient.resendEmailConfirmation({});
      setNote("Sent.");
    });

  const cancel = () =>
    run(async () => {
      const reply = await authClient.cancelEmailChange({});
      await showEmail(reply.email);
    });

  const begin = (form: "address" | "remove") => {
    setNote(null);
    setError(null);
    setOpen(form);
  };

  return (
    <section className="card email-section">
      <h3>Email</h3>
      {state === "none" && <p className="muted">No email address</p>}
      {email?.address && (
        <p>
          <strong>{email.address}</strong>
        </p>
      )}
      {email?.pendingAddress && (
        <p className="muted">Check {email.pendingAddress} for a link.</p>
      )}
      {open === "address" ? (
        <AddressForm
          hasPassword={hasPassword}
          onSent={(next) => {
            setOpen(null);
            void showEmail(next);
          }}
          onClose={() => setOpen(null)}
        />
      ) : open === "remove" ? (
        <RemoveForm
          hasPassword={hasPassword}
          onRemoved={() => {
            setOpen(null);
            void showEmail(undefined);
          }}
          onClose={() => setOpen(null)}
        />
      ) : (
        <>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="setting-actions">
            {actions.includes("add") && (
              <button
                type="button"
                className="primary"
                onClick={() => begin("address")}
              >
                Add
              </button>
            )}
            {actions.includes("change") && (
              <button
                type="button"
                className="chip"
                onClick={() => begin("address")}
              >
                Change
              </button>
            )}
            {actions.includes("remove") && (
              <button
                type="button"
                className="chip"
                onClick={() => begin("remove")}
              >
                Remove
              </button>
            )}
            {actions.includes("resend") && (
              <button
                type="button"
                className="chip"
                onClick={resend}
                disabled={busy}
              >
                Resend
              </button>
            )}
            {actions.includes("cancel") && (
              <button
                type="button"
                className="chip"
                onClick={cancel}
                disabled={busy}
              >
                Cancel
              </button>
            )}
            {note && <span className="muted small">{note}</span>}
          </div>
        </>
      )}
    </section>
  );
}
