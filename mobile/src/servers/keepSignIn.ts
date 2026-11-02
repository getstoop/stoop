import { type SavedServer, saveSignIn } from "../api/servers";
import { endReplaced, type Replaced, sessionToReplace } from "./replacedSession";

type Change = (apply: (list: SavedServer[]) => Promise<SavedServer[]>) => Promise<SavedServer[]>;

// Keeps a new session as a change to the list (serverList) and returns the
// server's local ID. The session being replaced is read inside the change,
// in turn and before the save, so a sign-in overlapping this one can't leave
// it reading a token already overwritten; it is dealt with only once the new
// one has saved.
export async function keepSignIn(change: Change, origin: string, name: string, token: string): Promise<string> {
  let replaced = null as Replaced | null;
  // saveSignIn puts the server it saved first.
  const list = await change(async (held) => {
    replaced = await sessionToReplace(held, origin);
    return saveSignIn(held, origin, name, token, replaced?.token ?? null);
  });
  if (replaced) await endReplaced(replaced, token);
  return list[0].id;
}
