import { Code, ConnectError } from "@connectrpc/connect";
import { confirm } from "../stores/dialogs";

// Whether the server refused a call for want of a recent sign-in: the
// marker internal/auth/reauth.go sets, wherever the call came from.
export function needsConfirming(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    err.code === Code.FailedPrecondition &&
    err.metadata.get("stoop-confirm") === "required"
  );
}

let asking = false;

// Offers "Confirm it's you" after such a refusal, and comes back to this
// page afterwards. Once at a time: a page that fires several refused calls
// asks once. The router is loaded here rather than imported, since it
// imports the clients that call this.
export async function askToConfirm() {
  if (asking) return;
  asking = true;
  try {
    const go = await confirm({
      title: "Confirm it's you",
      body: "This change needs you to log in again first. You'll come back here afterwards.",
      action: "Confirm it's you",
    });
    if (!go) return;
    const { router } = await import("../router");
    await router.navigate({
      to: "/confirm",
      search: { next: location.pathname + location.search },
    });
  } finally {
    asking = false;
  }
}
