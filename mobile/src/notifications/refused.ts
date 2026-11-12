import { type Permissions, shouldAsk } from "./shouldAsk";

// Whether the person has refused notifications: not granted, and not a
// state the app would still ask in (shouldAsk.ts), so the state before
// the first ask, and Android's askable denials, are not refusals.
export function isRefused(permissions: Permissions, os: string): boolean {
  return !permissions.granted && !shouldAsk(permissions, os);
}
