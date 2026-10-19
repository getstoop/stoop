import { Redirect, Slot, useLocalSearchParams } from "expo-router";
import { normalizeServerUrl } from "../../api/probe";

// /sign-in?server=<origin>, from Add a server. Without a server to sign
// in to there is nothing here.
export default function SignInLayout() {
  const { server } = useLocalSearchParams<{ server?: string }>();
  if (!server || !normalizeServerUrl(server)) return <Redirect href="/" />;
  return <Slot />;
}
