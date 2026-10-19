import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useEffect, useState } from "react";
import { useSessions } from "./queries";

// How long a sign-in counts as recent: the server's recentSignIn
// (internal/auth/reauth.go). The changes that could keep an account after
// its session is stolen need one, and confirming it's you (/confirm) is
// how to get one without signing out. The server is the judge; this only
// decides what the page offers.
export const RECENT_SIGN_IN_MS = 5 * 60 * 1000;

// Whether this session signed in recently enough for those changes;
// undefined until the sessions have loaded. It turns false by itself when
// the window closes.
export function useRecentSignIn(): boolean | undefined {
  const { data: sessions } = useSessions();
  const signedInAt = sessions?.find((s) => s.current)?.createdAt;
  const until = signedInAt
    ? timestampDate(signedInAt).getTime() + RECENT_SIGN_IN_MS
    : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), until - now);
    return () => clearTimeout(timer);
  }, [until, now]);
  if (!sessions) return undefined;
  return until > now;
}
