import { Redirect } from "expo-router";
import Welcome from "../screens/Welcome";
import { useServers } from "../servers";

// The app opens on the server signed in to or switched to last, or on
// Welcome when there is none. Sign-in lands on a server by coming back
// here, not by replacing to /s/<id>: with another server's
// /s/<id> under it, expo-router takes that for the same route and
// navigates inside its tabs, so the server never changes.
export default function Index() {
  const [last] = useServers().servers;
  if (last) return <Redirect href={{ pathname: "/s/[id]", params: { id: last.id } }} />;
  return <Welcome />;
}
