import type { MyEmail } from "../../../gen/stoop/auth/v1/auth_pb";

export type EmailState = "none" | "pending" | "confirmed" | "changing";

export type EmailAction = "add" | "change" | "remove" | "resend" | "cancel";

export function emailState(email: MyEmail | undefined): EmailState {
  const confirmed = !!email?.address;
  const pending = !!email?.pendingAddress;
  if (confirmed && pending) return "changing";
  if (confirmed) return "confirmed";
  if (pending) return "pending";
  return "none";
}

// While a link is out, the only moves are to send it again or drop it.
export function emailActions(state: EmailState): EmailAction[] {
  switch (state) {
    case "none":
      return ["add"];
    case "confirmed":
      return ["change", "remove"];
    case "pending":
    case "changing":
      return ["resend", "cancel"];
  }
}
