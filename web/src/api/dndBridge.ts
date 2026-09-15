import type { QueryClient } from "@tanstack/react-query";
import { onShellDnd, type ShellDnd, shellDnd } from "./platform";
import { setDoNotDisturb } from "./presence";

// The desktop app's do not disturb switch sets every server it holds, and
// this page sets its own, end included. As the page loads it only ever
// applies an "on": a switch that is off says nothing about this server, and
// pushing off would clear do not disturb set from another device. Turning
// the switch off does turn this server off. An end passing is left to the
// server, which ends it on its own. docs/proposals/presence-and-dnd.md.
// Returns the stop.
export function startDndBridge(queryClient: QueryClient): () => void {
  const apply = ({ on, until }: ShellDnd) => {
    // A failure leaves the server as it was; the next change tries again.
    setDoNotDisturb(
      queryClient,
      on,
      on && until !== null ? new Date(until) : undefined,
    ).catch(() => {});
  };
  const now = shellDnd();
  if (now?.on) apply(now);
  return onShellDnd(apply);
}
