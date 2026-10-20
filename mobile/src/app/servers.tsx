import { useLocalSearchParams } from "expo-router";
import ServerSwitcher from "../screens/ServerSwitcher";

// /servers?current=<id>, the sheet from the Spaces tab's header. Outside
// the server's tabs: it lists every server on the phone.
export default function ServersRoute() {
  const { current } = useLocalSearchParams<{ current?: string }>();
  return <ServerSwitcher current={current} />;
}
