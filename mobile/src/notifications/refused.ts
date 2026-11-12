import { type Permissions, shouldAsk } from "./shouldAsk";

// Whether the person has refused notifications: not granted, and not a
// state the app would still ask in (shouldAsk.ts), so the state before
// the first ask, and Android's askable denials, are not refusals. An
// ask this run that left it ungranted is one, though: Android still
// says askable after a first "Don't allow".
export function isRefused(permissions: Permissions, os: string, askedThisRun = false): boolean {
  return !permissions.granted && (askedThisRun || !shouldAsk(permissions, os));
}
