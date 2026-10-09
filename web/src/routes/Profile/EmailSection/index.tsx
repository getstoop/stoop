import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  const state = emailState(email);
  const actions = emailActions(state);

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

  const run = async (action: () => Promise<void>) => {
    setNote(null);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
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
              <button type="button" className="chip" onClick={resend}>
                Resend
              </button>
            )}
            {actions.includes("cancel") && (
              <button type="button" className="chip" onClick={cancel}>
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
