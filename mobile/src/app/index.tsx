import { Redirect } from "expo-router";
import Welcome from "../screens/Welcome";
import { useServers } from "../servers";

// The app opens on the server signed in to last, or on Welcome when
// there is none.
export default function Index() {
  const [last] = useServers().servers;
  if (last) return <Redirect href={{ pathname: "/s/[id]", params: { id: last.id } }} />;
  return <Welcome />;
}
