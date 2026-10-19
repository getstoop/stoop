import { Redirect, useLocalSearchParams } from "expo-router";
import { normalizeServerUrl } from "../api/probe";
import ForgotPassword from "../screens/ForgotPassword";

// /forgot-password?server=<origin>, from sign-in. The check lives in the
// route, as sign-in's does: a layout's params don't carry the ?query.
export default function ForgotPasswordRoute() {
  const { server } = useLocalSearchParams<{ server?: string }>();
  const origin = normalizeServerUrl(server ?? "");
  if (!origin) return <Redirect href="/" />;
  return <ForgotPassword origin={origin} />;
}
