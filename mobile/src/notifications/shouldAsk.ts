// Whether the system's prompt should be shown: only while the person
// has not answered. Android never says "undetermined": before the
// first ask, and after one refusal, it says denied but askable, so
// there the app asks while it still may, which the system allows twice.

export type Permissions = { status: string; granted: boolean; canAskAgain: boolean };

export function shouldAsk({ status, granted, canAskAgain }: Permissions, os: string): boolean {
  if (status === "undetermined") return true;
  return os === "android" && !granted && canAskAgain;
}
