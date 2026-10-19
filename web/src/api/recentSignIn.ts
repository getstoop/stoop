import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useEffect, useState } from "react";
import { useSessions } from "./queries";

// How long a sign-in counts as recent: the server's recentSignIn
// (internal/auth/reauth.go). The changes that could keep an account after
// its session is stolen need one, and confirming it's you (/confirm) is
// how to get one without signing out. The server is the judge; this only
// decides what the page offers.
export const RECENT_SIGN_IN_MS = 5 * 60 * 1000;

// Whether a section that needs a recent sign-in is waiting for one: it is
// then inert, so nothing in it can be clicked, typed into or tabbed to
// until the person confirms it's them (ConfirmBanner).
export function useWaitingToConfirm(): boolean {
  return useRecentSignIn() === false;
}

// Whether this session signed in recently enough for those changes;
// undefined until the sessions have loaded. It turns false by itself when
// the window closes.
export function useRecentSignIn(): boolean | undefined {
  const { data: sessions } = useSessions();
  const signedInAt = sessions?.find((s) => s.current)?.createdAt;
  const until = signedInAt
    ? timestampDate(signedInAt).getTime() + RECENT_SIGN_IN_MS
    : 0;
  // Rendered state, updated when the window closes. The delay is counted
  // from the clock when the deadline changes, never from the last render,
  // which may be long ago (a replacement session arriving later).
  const [recent, setRecent] = useState(() => until > Date.now());
  useEffect(() => {
    const left = until - Date.now();
    setRecent(left > 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setRecent(false), left);
    return () => clearTimeout(timer);
  }, [until]);
  if (!sessions) return undefined;
  return recent;
}
