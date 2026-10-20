import { Redirect, useLocalSearchParams } from "expo-router";
import { normalizeServerUrl } from "../../api/probe";
import SignIn from "../../screens/SignIn";

// /sign-in?server=<origin>, from Add a server, with &invite=<code> from
// Invite's "Sign in & join". Without a server to sign
// in to there is nothing here. The check lives in the route, not a
// _layout: a layout's own params don't carry the ?query.
export default function SignInRoute() {
  const { server, invite } = useLocalSearchParams<{ server?: string; invite?: string }>();
  const origin = normalizeServerUrl(server ?? "");
  if (!origin) return <Redirect href="/" />;
  return <SignIn origin={origin} invite={invite || undefined} />;
}
