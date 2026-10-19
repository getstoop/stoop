import { useLocalSearchParams } from "expo-router";
import { normalizeServerUrl } from "../../api/probe";
import SignIn from "../../screens/SignIn";

export default function SignInRoute() {
  const { server } = useLocalSearchParams<{ server: string }>();
  const origin = normalizeServerUrl(server);
  return origin ? <SignIn origin={origin} /> : null;
}
