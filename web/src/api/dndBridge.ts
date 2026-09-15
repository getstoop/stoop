import type { QueryClient } from "@tanstack/react-query";
import { onShellDnd, shellDnd } from "./platform";
import { setDoNotDisturb } from "./presence";

// The desktop app's do not disturb switch sets every server it holds, and
// this page sets its own. As the page loads it only ever applies an "on":
// a switch that is off says nothing about this server, and pushing off
// would clear do not disturb set from another device. Turning the switch
// off does turn this server off. docs/proposals/presence-and-dnd.md.
// Returns the stop.
export function startDndBridge(queryClient: QueryClient): () => void {
  const apply = (on: boolean) => {
    // A failure leaves the server as it was; the next change tries again.
    setDoNotDisturb(queryClient, on).catch(() => {});
  };
  if (shellDnd() === true) apply(true);
  return onShellDnd(apply);
}
