import { useRouter } from "expo-router";
import { useCallback } from "react";
import { usePushOnce } from "./usePushOnce";

// "Sign in again", where a sign-in has ended. Sign-in is pushed over the
// screen that says so, not put in its place: back returns there, and from
// there the switcher reaches another server. Signing in clears what is
// under it (SignIn's finish).
export function useSignInAgain(origin: string): () => void {
  const router = useRouter();
  const pushOnce = usePushOnce();
  return useCallback(() => {
    pushOnce(() => router.push({ pathname: "/sign-in", params: { server: origin } }));
  }, [pushOnce, router, origin]);
}
